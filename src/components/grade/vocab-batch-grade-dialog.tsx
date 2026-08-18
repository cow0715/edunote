'use client'

// 일괄 사진 채점 — 학생 수만큼 사진을 한 번에 넣고, 이름 자동 매칭을 확인한 뒤, 병렬로 채점한다.
//
// 흐름:  파일 드롭/선택 → (이름란 판독, 동시 3) → 매칭 표에서 확인·수정 → 채점 시작 (동시 3) → 진행/결과
// 설계 메모:
// - 채점은 학생당 별도 요청. Vercel Hobby 60초 제한(요청당)을 피하고, 하나 실패해도 나머지는 계속.
// - 이름 매칭은 잘못 매칭보다 미매칭이 낫다 — 자동 매칭은 확신도와 함께 보여주고 반드시 강사가 확인.
// - 같은 학생에 사진 2장이 붙으면 경고 (뒤 사진이 앞 사진 결과를 덮어쓴다).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { VocabResult } from './vocab-photo-button'

type Student = { student_id: string; student_name: string; present: boolean; hasExisting: boolean }

type Confidence = 'high' | 'low' | 'none'
type Phase = 'pick' | 'matching' | 'review' | 'grading' | 'done'

type Item = {
  id: string
  file: File
  previewUrl: string
  b64: string | null
  studentId: string | null
  confidence: Confidence
  rawName: string | null
  status: 'idle' | 'reading' | 'ready' | 'grading' | 'done' | 'error'
  error?: string
  result?: { vocab_correct: number; vocab_total: number }
}

const CONCURRENCY = 3

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** 동시 실행 수를 제한하며 순서대로 작업을 돌린다 */
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

export function VocabBatchGradeDialog({ open, onOpenChange, weekId, students, onGraded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekId: string
  students: Student[]
  /** 학생 한 명 채점 완료마다 호출 — 그리드의 점수 갱신용 */
  onGraded: (studentId: string, vocabCorrect: number, total: number, results: VocabResult[]) => void
}) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [items, setItems] = useState<Item[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }, [])

  // 닫힐 때 초기화 — effect 안 setState 대신 렌더 중 조정 (AGENTS.md 패턴).
  // object URL 해제(revokeObjectURL)는 멱등이라 렌더 재실행에도 안전하다.
  const [syncedOpen, setSyncedOpen] = useState(open)
  if (syncedOpen !== open) {
    setSyncedOpen(open)
    if (!open) {
      items.forEach((it) => URL.revokeObjectURL(it.previewUrl))
      setItems([])
      setPhase('pick')
    }
  }
  // 언마운트 시 남은 URL 해제
  useEffect(() => () => { items.forEach((it) => URL.revokeObjectURL(it.previewUrl)) }, [items])

  const presentStudents = useMemo(() => students.filter((s) => s.present), [students])

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (list.length === 0) return
    const fresh: Item[] = list.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      b64: null,
      studentId: null,
      confidence: 'none',
      rawName: null,
      status: 'idle',
    }))
    setItems((prev) => [...prev, ...fresh])
    setPhase('matching')

    // base64 인코딩 + 이름 판독 (동시 3)
    await runPool(fresh, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'reading' })
      try {
        const b64 = await readAsBase64(it.file)
        patch(it.id, { b64 })
        const resp = await fetch(`/api/weeks/${weekId}/vocab-photo-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: b64, mimeType: it.file.type }),
        })
        const data = await resp.json() as { studentId: string | null; rawName: string | null; confidence: Confidence }
        // 자동 매칭은 present 학생으로만
        const ok = data.studentId && presentStudents.some((s) => s.student_id === data.studentId)
        patch(it.id, {
          studentId: ok ? data.studentId : null,
          confidence: ok ? data.confidence : 'none',
          rawName: data.rawName ?? null,
          status: 'ready',
        })
      } catch {
        patch(it.id, { status: 'ready', confidence: 'none' })
      }
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
  const readyToGrade = items.filter((it) => it.studentId && it.b64)
  const overwriteCount = readyToGrade.filter((it) => students.find((s) => s.student_id === it.studentId)?.hasExisting).length

  async function startGrading() {
    if (readyToGrade.length === 0) return
    if (overwriteCount > 0) {
      const ok = window.confirm(`${overwriteCount}명은 이미 채점된 데이터가 있습니다.\n교사 확정(잠금) 항목을 제외한 기존 결과가 덮어씌워집니다.\n계속하시겠습니까?`)
      if (!ok) return
    }
    setPhase('grading')
    await runPool(readyToGrade, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'grading', error: undefined })
      try {
        const resp = await fetch(`/api/weeks/${weekId}/grade-vocab-photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: it.studentId, fileData: it.b64, mimeType: it.file.type }),
        })
        const data = await resp.json()
        if (data.ok) {
          patch(it.id, { status: 'done', result: { vocab_correct: data.vocab_correct, vocab_total: data.vocab_total } })
          onGraded(it.studentId!, data.vocab_correct, data.vocab_total, data.results)
        } else {
          patch(it.id, { status: 'error', error: data.error ?? '채점 실패' })
        }
      } catch {
        patch(it.id, { status: 'error', error: '네트워크 오류' })
      }
    })
    setPhase('done')
  }

  async function retryFailed() {
    const failed = items.filter((it) => it.status === 'error' && it.studentId && it.b64)
    if (failed.length === 0) return
    setPhase('grading')
    await runPool(failed, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'grading', error: undefined })
      try {
        const resp = await fetch(`/api/weeks/${weekId}/grade-vocab-photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: it.studentId, fileData: it.b64, mimeType: it.file.type }),
        })
        const data = await resp.json()
        if (data.ok) {
          patch(it.id, { status: 'done', result: { vocab_correct: data.vocab_correct, vocab_total: data.vocab_total } })
          onGraded(it.studentId!, data.vocab_correct, data.vocab_total, data.results)
        } else patch(it.id, { status: 'error', error: data.error ?? '채점 실패' })
      } catch {
        patch(it.id, { status: 'error', error: '네트워크 오류' })
      }
    })
    setPhase('done')
  }

  const doneCount = items.filter((it) => it.status === 'done').length
  const errorCount = items.filter((it) => it.status === 'error').length
  const gradingCount = items.filter((it) => it.status === 'grading').length
  const isBusy = phase === 'matching' || phase === 'grading'

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isBusy) onOpenChange(v) }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">단어 시험지 일괄 채점</DialogTitle>
          <p className="text-xs text-gray-500">
            {phase === 'pick' && '학생들 시험지 사진을 한 번에 넣으면 이름을 읽어 자동으로 매칭합니다.'}
            {phase === 'matching' && '이름란을 읽는 중…'}
            {phase === 'review' && '매칭이 맞는지 확인하고 채점을 시작하세요. 틀린 건 직접 고르면 됩니다.'}
            {phase === 'grading' && `채점 중 ${doneCount + errorCount} / ${readyToGrade.length}`}
            {phase === 'done' && `완료 ${doneCount}명${errorCount > 0 ? ` · 실패 ${errorCount}명` : ''}`}
          </p>
        </DialogHeader>

        <div className="max-h-[calc(90vh-140px)] overflow-y-auto px-5 py-4">
          {/* 드롭존 — pick/review 단계에서 추가 가능 */}
          {(phase === 'pick' || phase === 'review') && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'mb-4 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 text-center transition-colors',
                dragOver ? 'border-indigo-400 bg-indigo-50/60' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50',
              )}
            >
              <ImagePlus className="h-6 w-6 text-indigo-400" />
              <p className="text-sm font-medium text-gray-700">{items.length === 0 ? '사진을 여기에 놓거나 클릭해서 선택' : '사진 더 추가'}</p>
              <p className="text-[11px] text-gray-400">여러 장 한 번에 · 이미지/PDF · 학생 한 명당 한 장</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }}
              />
            </div>
          )}

          {items.length > 0 && (
            <div className="space-y-1.5">
              {items.map((it) => {
                const isDup = it.studentId ? duplicateStudentIds.has(it.studentId) : false
                return (
                  <div
                    key={it.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-2.5 py-2',
                      it.status === 'error' ? 'border-rose-200 bg-rose-50/40'
                        : it.status === 'done' ? 'border-emerald-200 bg-emerald-50/40'
                        : !it.studentId && it.status === 'ready' ? 'border-amber-200 bg-amber-50/40'
                        : 'border-gray-100',
                    )}
                  >
                    {/* 썸네일 */}
                    {it.file.type.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.previewUrl} alt="" className="h-12 w-9 shrink-0 rounded object-cover ring-1 ring-gray-200" />
                    ) : (
                      <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-gray-100 text-[9px] font-bold text-gray-500 ring-1 ring-gray-200">PDF</div>
                    )}

                    {/* 파일명 + 읽은 이름 */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-gray-500">{it.file.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-gray-400">
                        {it.status === 'reading' ? '이름 읽는 중…'
                          : it.rawName ? `읽은 이름: ${it.rawName}`
                          : it.status === 'ready' || phase !== 'matching' ? '이름을 못 읽음' : ''}
                      </p>
                    </div>

                    {/* 학생 선택 */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      {it.status === 'reading' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
                      ) : (
                        <>
                          <select
                            value={it.studentId ?? ''}
                            disabled={it.status === 'grading' || it.status === 'done'}
                            onChange={(e) => patch(it.id, { studentId: e.target.value || null, confidence: e.target.value ? 'high' : 'none' })}
                            className={cn(
                              'h-8 w-32 rounded-md border bg-white px-2 text-xs',
                              !it.studentId ? 'border-amber-300 text-amber-700' : isDup ? 'border-rose-300' : 'border-gray-200',
                            )}
                          >
                            <option value="">— 학생 선택 —</option>
                            {students.map((s) => (
                              <option key={s.student_id} value={s.student_id} disabled={!s.present}>
                                {s.student_name}{!s.present ? ' (결석)' : ''}
                              </option>
                            ))}
                          </select>
                          {it.studentId && it.status === 'ready' && (
                            <span
                              title={it.confidence === 'high' ? '자동 매칭 (확실)' : it.confidence === 'low' ? '자동 매칭 (불확실 — 확인 필요)' : '직접 선택'}
                              className={cn('h-2 w-2 shrink-0 rounded-full', it.confidence === 'high' ? 'bg-emerald-400' : it.confidence === 'low' ? 'bg-amber-400' : 'bg-gray-300')}
                            />
                          )}
                        </>
                      )}
                    </div>

                    {/* 상태 */}
                    <div className="flex w-20 shrink-0 items-center justify-end gap-1 text-xs">
                      {it.status === 'grading' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" /><span className="text-indigo-500">채점 중</span></>}
                      {it.status === 'done' && it.result && <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="font-semibold text-emerald-700">{it.result.vocab_correct}/{it.result.vocab_total}</span></>}
                      {it.status === 'error' && <><XCircle className="h-3.5 w-3.5 text-rose-400" /><span className="truncate text-rose-500" title={it.error}>실패</span></>}
                      {isDup && it.status === 'ready' && <span title="같은 학생에 사진이 2장 이상 — 뒤 사진이 앞 결과를 덮어씁니다"><AlertTriangle className="h-3.5 w-3.5 text-rose-400" /></span>}
                      {(it.status === 'ready' || it.status === 'idle') && !isDup && (
                        <button type="button" onClick={() => removeItem(it.id)} className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500" title="제거">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 하단 액션 */}
        <div className="flex items-center justify-between gap-3 border-t bg-gray-50/60 px-5 py-3">
          <p className="text-xs text-gray-500">
            {phase === 'review' && (
              <>
                {readyToGrade.length}명 채점 준비
                {unmatched > 0 && <span className="ml-2 text-amber-600">· 미매칭 {unmatched}장 (채점에서 제외)</span>}
                {duplicateStudentIds.size > 0 && <span className="ml-2 text-rose-600">· 중복 매칭 {duplicateStudentIds.size}명</span>}
                {overwriteCount > 0 && <span className="ml-2 text-gray-500">· 재채점 {overwriteCount}명</span>}
              </>
            )}
            {phase === 'grading' && `동시 ${Math.min(CONCURRENCY, gradingCount || 1)}명씩 · 학생당 15~20초`}
            {phase === 'done' && errorCount > 0 && '실패한 건은 재시도하거나 학생 행에서 개별 채점하세요.'}
          </p>
          <div className="flex items-center gap-2">
            {phase === 'done' && errorCount > 0 && (
              <Button size="sm" variant="outline" onClick={retryFailed}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                실패 {errorCount}건 재시도
              </Button>
            )}
            {phase === 'done' ? (
              <Button size="sm" onClick={() => onOpenChange(false)}>닫기</Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => onOpenChange(false)}>취소</Button>
                <Button size="sm" disabled={phase !== 'review' || readyToGrade.length === 0 || duplicateStudentIds.size > 0} onClick={startGrading}>
                  {phase === 'grading' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {readyToGrade.length > 0 ? `${readyToGrade.length}명 채점 시작` : '채점 시작'}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
