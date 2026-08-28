'use client'

// 진단평가 답안지 일괄 판독 — 반 전체 답안지 사진을 한 번에 넣고, 이름 자동 매칭을 확인한 뒤,
// 병렬로 OCR 해 학생별 답안을 그리드에 채운다 (임시저장까지. AI 채점은 "채점 저장" 한 번으로).
//
// 흐름:  파일 드롭/선택 → (이름란 판독, 병렬) → 매칭 표에서 확인·수정 → 판독 시작 (병렬) → 진행/결과
// 설계 메모 (vocab-batch-grade-dialog 와 동일 패턴):
// - 판독은 학생당 별도 요청. 하나 실패해도 나머지는 계속.
// - 이름 매칭은 잘못 매칭보다 미매칭이 낫다 — 자동 매칭은 반드시 강사가 확인. 동명이인은 서버가
//   자동 매칭을 거부하고 수동 선택을 강제한다.
// - 단어 일괄 채점과 달리 여기선 저장을 확정하지 않는다 — OCR 결과는 손글씨 오독 여지가 있어
//   그리드에 채우고 임시저장까지만. 최종 정오는 "채점 저장"의 코드+AI 채점이 정한다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runOrReport } from '@/lib/async-ui'
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { compressImageForUpload } from '@/lib/image-compress'
import type { ExamOcrResult } from './exam-photo-button'

type Student = { student_id: string; student_name: string; present: boolean; hasExisting: boolean }

type Confidence = 'high' | 'low' | 'none'
type Phase = 'pick' | 'matching' | 'review' | 'reading' | 'done'

type Item = {
  id: string
  file: File
  previewUrl: string
  /** 압축된 base64 + mime (원본이 아니라 압축본을 보낸다) */
  b64: string | null
  mimeType: string
  studentId: string | null
  confidence: Confidence
  rawName: string | null
  /** 동명이인이라 자동 매칭이 거부된 경우 */
  duplicateName: boolean
  status: 'idle' | 'reading-name' | 'ready' | 'reading' | 'done' | 'error'
  error?: string
  result?: { applied: number; total: number }
}

// 반 정원이 15명 이하라 전 학생 동시 실행 — 학생당 별도 서버 요청이라 서로 안 막힌다.
// LLM 요청 한도에 걸려 개별 실패하면 항목별 오류 + 재시도 버튼으로 복구.
const CONCURRENCY = 15

/** 동시 실행 수를 제한하며 순서대로 작업을 돌린다 (worker 는 항목별로 오류를 삼킨다) */
async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await worker(items[i], i)
    }
  })
  await Promise.all(runners)
}

export function ExamBatchGradeDialog({ open, onOpenChange, weekId, students, questionCount, onApplied }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekId: string
  students: Student[]
  /** 채점 대상 문항 수 (무효 제외) — 판독 결과 요약 표시용 */
  questionCount: number
  /** 학생 한 명 판독 완료마다 호출 — 그리드 답안 반영 + 임시저장. 반영된 문항 수를 돌려준다 */
  onApplied: (studentId: string, results: ExamOcrResult[]) => number
}) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [items, setItems] = useState<Item[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }, [])

  // 닫힐 때 초기화 — effect 안 setState 대신 렌더 중 조정 (AGENTS.md 패턴).
  const [syncedOpen, setSyncedOpen] = useState(open)
  if (syncedOpen !== open) {
    setSyncedOpen(open)
    if (!open) {
      items.forEach((it) => URL.revokeObjectURL(it.previewUrl))
      setItems([])
      setPhase('pick')
    }
  }
  // 언마운트 시 남은 URL 해제 (vocab 다이얼로그와 같은 이유로 ref 경유)
  const itemsRef = useRef<Item[]>([])
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => () => { itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl)) }, [])

  const presentStudents = useMemo(() => students.filter((s) => s.present), [students])

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (list.length === 0) return
    const fresh: Item[] = list.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      b64: null,
      mimeType: file.type,
      studentId: null,
      confidence: 'none',
      rawName: null,
      duplicateName: false,
      status: 'idle',
    }))
    setItems((prev) => [...prev, ...fresh])
    setPhase('matching')

    // base64 인코딩 + 이름 판독 (병렬)
    await runPool(fresh, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'reading-name' })
      await runOrReport(async () => {
        const { base64: b64, mimeType } = await compressImageForUpload(it.file)
        patch(it.id, { b64, mimeType })
        const resp = await fetch(`/api/weeks/${weekId}/vocab-photo-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: b64, mimeType }),
        })
        const data = await resp.json() as { studentId: string | null; rawName: string | null; confidence: Confidence; duplicate?: boolean }
        const ok = data.studentId && presentStudents.some((s) => s.student_id === data.studentId)
        patch(it.id, {
          studentId: ok ? data.studentId : null,
          confidence: ok ? data.confidence : 'none',
          rawName: data.rawName ?? null,
          duplicateName: data.duplicate ?? false,
          status: 'ready',
        })
      }, () => patch(it.id, { status: 'ready', confidence: 'none' }))
    })
    setPhase('review')
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((it) => it.id !== id)
    })
  }

  // 같은 학생에 사진이 2장 이상 붙었는지
  const duplicateStudentIds = useMemo(() => {
    const count = new Map<string, number>()
    for (const it of items) if (it.studentId) count.set(it.studentId, (count.get(it.studentId) ?? 0) + 1)
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([id]) => id))
  }, [items])

  const unmatched = items.filter((it) => !it.studentId).length
  const readyToRead = items.filter((it) => it.studentId && it.b64)
  const overwriteCount = readyToRead.filter((it) => students.find((s) => s.student_id === it.studentId)?.hasExisting).length

  const readOne = useCallback(async (it: Item) => {
    patch(it.id, { status: 'reading', error: undefined })
    await runOrReport(async () => {
      const resp = await fetch(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: it.b64, mimeType: it.mimeType, studentId: it.studentId }),
      })
      const data = await resp.json()
      if (data.ok) {
        const applied = onApplied(it.studentId!, data.results as ExamOcrResult[])
        patch(it.id, { status: 'done', result: { applied, total: questionCount } })
      } else {
        patch(it.id, { status: 'error', error: data.error ?? 'OCR 실패' })
      }
    }, () => patch(it.id, { status: 'error', error: '네트워크 오류' }))
  }, [weekId, questionCount, onApplied, patch])

  async function startReading() {
    if (readyToRead.length === 0) return
    if (overwriteCount > 0) {
      const ok = window.confirm(`${overwriteCount}명은 이미 입력된 답안이 있습니다.\n판독 결과로 화면의 답안이 덮어씌워집니다 (저장은 "채점 저장" 때 확정).\n계속하시겠습니까?`)
      if (!ok) return
    }
    setPhase('reading')
    await runPool(readyToRead, CONCURRENCY, readOne)
    setPhase('done')
  }

  async function retryFailed() {
    const failed = items.filter((it) => it.status === 'error' && it.studentId && it.b64)
    if (failed.length === 0) return
    setPhase('reading')
    await runPool(failed, CONCURRENCY, readOne)
    setPhase('done')
  }

  const doneCount = items.filter((it) => it.status === 'done').length
  const errorCount = items.filter((it) => it.status === 'error').length
  const isBusy = phase === 'matching' || phase === 'reading'

  /** 닫기 요청 처리 — vocab 다이얼로그와 같은 규칙 */
  function requestClose() {
    if (isBusy) return
    const pendingCount = items.filter((it) => it.status !== 'done').length
    if (items.length > 0 && pendingCount > 0) {
      const msg = phase === 'done'
        ? `실패 ${errorCount}건이 남아 있습니다. 닫으면 목록이 사라집니다. (완료된 ${doneCount}명은 그리드에 반영됨)\n닫을까요?`
        : `넣어둔 사진 ${items.length}장이 사라집니다. 닫을까요?`
      if (!window.confirm(msg)) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) requestClose(); else onOpenChange(v) }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0" showCloseButton={false}>
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">답안지 일괄 판독</DialogTitle>
          <p className="text-xs text-gray-500">
            {phase === 'pick' && '학생들 답안지 사진을 한 번에 넣으면 이름을 읽어 자동으로 매칭합니다.'}
            {phase === 'matching' && '이름란을 읽는 중…'}
            {phase === 'review' && '매칭을 확인하세요. 판독 결과는 그리드에 채워지고, 채점은 "채점 저장"으로 확정합니다.'}
            {phase === 'reading' && '답안을 읽는 중…'}
            {phase === 'done' && `완료 ${doneCount}명${errorCount > 0 ? ` · 실패 ${errorCount}건` : ''} — 그리드에서 확인 후 채점 저장을 눌러주세요.`}
          </p>
        </DialogHeader>

        <div className="max-h-[calc(90vh-140px)] overflow-y-auto px-5 py-4">
          {/* 파일 넣기 영역 */}
          {(phase === 'pick' || phase === 'review') && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'mb-4 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 transition-colors',
                dragOver ? 'border-indigo-400 bg-indigo-50/60' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/60'
              )}
            >
              <ImagePlus className="h-5 w-5 text-gray-400" />
              <p className="text-xs text-gray-500">사진을 끌어다 놓거나 클릭해서 선택 (여러 장 가능)</p>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
              />
            </div>
          )}

          {/* 항목 목록 */}
          {items.length > 0 && (
            <ul className="space-y-2">
              {items.map((it) => {
                const student = students.find((s) => s.student_id === it.studentId)
                const isDupPhoto = !!it.studentId && duplicateStudentIds.has(it.studentId)
                return (
                  <li key={it.id} className={cn('flex items-center gap-3 rounded-lg border p-2', it.status === 'error' && 'border-red-200 bg-red-50/40')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover bg-gray-100" />

                    {/* 파일명 + 읽은 이름 */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-gray-700">{it.file.name}</p>
                      <p className="text-[11px] text-gray-400">
                        {it.status === 'reading-name' ? '이름 읽는 중…'
                          : it.duplicateName ? `동명이인(${it.rawName}) — 직접 선택`
                          : it.rawName ? `읽은 이름: ${it.rawName}`
                          : it.status === 'ready' || phase !== 'matching' ? '이름을 못 읽음' : ''}
                      </p>
                    </div>

                    {/* 학생 매칭 셀렉트 */}
                    {phase !== 'pick' && (
                      <select
                        value={it.studentId ?? ''}
                        disabled={isBusy || it.status === 'done'}
                        onChange={(e) => patch(it.id, { studentId: e.target.value || null })}
                        className={cn(
                          'h-8 w-32 shrink-0 rounded-md border px-2 text-xs',
                          !it.studentId ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200'
                        )}
                      >
                        <option value="">미매칭</option>
                        {presentStudents.map((s) => (
                          <option key={s.student_id} value={s.student_id}>{s.student_name}</option>
                        ))}
                      </select>
                    )}

                    {/* 상태 */}
                    <div className="flex w-24 shrink-0 items-center justify-end gap-1.5 text-xs">
                      {it.status === 'reading' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" /><span className="text-indigo-600">판독 중</span></>}
                      {it.status === 'done' && it.result && <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="font-semibold text-emerald-700">{it.result.applied}/{it.result.total}문항</span></>}
                      {it.status === 'error' && <><XCircle className="h-3.5 w-3.5 text-red-400" /><span className="text-red-500">{it.error}</span></>}
                      {isDupPhoto && it.status !== 'done' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                      {student?.hasExisting && it.status === 'ready' && <span className="text-[10px] text-amber-600">덮어씀</span>}
                    </div>

                    {!isBusy && it.status !== 'done' && (
                      <button type="button" onClick={() => removeItem(it.id)} className="shrink-0 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* 하단 액션 */}
        <div className="flex items-center justify-between border-t px-5 py-3">
          <p className="text-xs text-gray-400">
            {items.length > 0 && `${items.length}장 · 매칭 ${items.length - unmatched} · 미매칭 ${unmatched}`}
            {duplicateStudentIds.size > 0 && ` · 같은 학생 중복 ${duplicateStudentIds.size}명`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={requestClose} disabled={isBusy}>
              {phase === 'done' ? '닫기' : '취소'}
            </Button>
            {phase === 'done' && errorCount > 0 && (
              <Button size="sm" variant="outline" onClick={retryFailed}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> 실패 재시도
              </Button>
            )}
            {phase !== 'done' && (
              <Button size="sm" onClick={startReading} disabled={isBusy || readyToRead.length === 0}>
                {phase === 'reading' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                판독 시작{readyToRead.length > 0 ? ` (${readyToRead.length}명)` : ''}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
