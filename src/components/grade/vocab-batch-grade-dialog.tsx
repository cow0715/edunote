'use client'

// 일괄 사진 채점 — 학생 수만큼 사진을 한 번에 넣고, 이름 자동 매칭을 확인한 뒤, 병렬로 채점한다.
//
// 흐름:  파일 드롭/선택 → (이름란 판독, 병렬) → 매칭 표에서 확인·수정 → 채점 시작 (병렬) → 진행/결과
// 설계 메모:
// - 채점은 학생당 별도 요청. Vercel Hobby 60초 제한(요청당)을 피하고, 하나 실패해도 나머지는 계속.
// - 이름 매칭은 잘못 매칭보다 미매칭이 낫다 — 자동 매칭은 확신도와 함께 보여주고 반드시 강사가 확인.
// - 같은 학생에 사진 2장이 붙으면 경고 (뒤 사진이 앞 사진 결과를 덮어쓴다).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runOrReport } from '@/lib/async-ui'
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn, formatNumberRanges } from '@/lib/utils'
import { useCaptureRuntime } from './capture-runtime'
import type { VocabResult } from './vocab-photo-button'
import { MobileCapture } from './mobile-capture'
import { ExamStudentConfirmationCard } from './exam-student-confirmation-card'
import { duplicateExamStudents, isExamStudentConfirmed } from '@/lib/exam-student-confirmation'

type Student = { student_id: string; student_name: string; present: boolean; hasExisting: boolean }

type Confidence = 'high' | 'low' | 'none'
type Phase = 'pick' | 'matching' | 'review' | 'grading' | 'done'

type Item = {
  id: string
  file: File
  previewUrl: string
  /** 압축된 base64 + mime (원본이 아니라 압축본을 보낸다) */
  b64: string | null
  mimeType: string
  studentId: string | null
  confirmedStudentId: string | null
  confidence: Confidence
  rawName: string | null
  status: 'idle' | 'reading' | 'ready' | 'grading' | 'done' | 'error'
  error?: string
  result?: { vocab_correct: number; vocab_total: number; missing: number[] }
}

// 반 정원이 15명 이하라 전 학생 동시 실행 — 학생당 별도 서버 요청이라 서로 안 막힌다.
// LLM 요청 한도에 걸려 개별 실패하면 항목별 오류 + 재시도 버튼으로 복구.
const CONCURRENCY = 15

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
  const { request, compress, pickFiles } = useCaptureRuntime()
  const [phase, setPhase] = useState<Phase>('pick')
  const [items, setItems] = useState<Item[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [captureBusy, setCaptureBusy] = useState(false)
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
  // 언마운트 시 남은 URL 해제. deps 를 [items] 로 두면 items 가 바뀔 때마다(채점 진행 patch 등)
  // 이전 썸네일 URL 이 해제돼 이미지가 깨진다 → 최신 items 를 ref 로 들고 언마운트 때만 해제
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
      confirmedStudentId: null,
      confidence: 'none',
      rawName: null,
      status: 'idle',
    }))
    setItems((prev) => [...prev, ...fresh])
    setPhase('matching')

    // base64 인코딩 + 이름 판독 (병렬)
    await runPool(fresh, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'reading' })
      await runOrReport(async () => {
        // 압축본을 이름 판독·채점 양쪽에 재사용
        const { base64: b64, mimeType } = await compress(it.file)
        patch(it.id, { b64, mimeType })
        const resp = await request(`/api/weeks/${weekId}/vocab-photo-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: b64, mimeType }),
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
  const duplicateStudentIds = useMemo(() => duplicateExamStudents(items), [items])

  const unmatched = items.filter((it) => !it.studentId).length
  const readyToGrade = items.filter((it) => it.studentId && it.b64)
  const confirmedCount = items.filter((it) => isExamStudentConfirmed(it, duplicateStudentIds)).length
  const allConfirmed = items.length > 0 && confirmedCount === items.length && readyToGrade.length === items.length
  const overwriteCount = readyToGrade.filter((it) => students.find((s) => s.student_id === it.studentId)?.hasExisting).length

  async function startGrading() {
    if (phase !== 'review' || !allConfirmed) return
    setPhase('grading')
    await runPool(readyToGrade, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'grading', error: undefined })
      await runOrReport(async () => {
        const resp = await request(`/api/weeks/${weekId}/grade-vocab-photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: it.studentId, fileData: it.b64, mimeType: it.mimeType }),
        })
        const data = await resp.json()
        if (data.ok) {
          patch(it.id, { status: 'done', result: { vocab_correct: data.vocab_correct, vocab_total: data.vocab_total, missing: data.missing_numbers ?? [] } })
          onGraded(it.studentId!, data.vocab_correct, data.vocab_total, data.results)
        } else {
          patch(it.id, { status: 'error', error: data.error ?? '채점 실패' })
        }
      }, () => patch(it.id, { status: 'error', error: '네트워크 오류' }))
    })
    setPhase('done')
  }

  async function retryFailed() {
    if (!allConfirmed) return
    const failed = items.filter((it) => it.status === 'error' && it.b64 && isExamStudentConfirmed(it, duplicateStudentIds))
    if (failed.length === 0) return
    setPhase('grading')
    await runPool(failed, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'grading', error: undefined })
      await runOrReport(async () => {
        const resp = await request(`/api/weeks/${weekId}/grade-vocab-photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: it.studentId, fileData: it.b64, mimeType: it.mimeType }),
        })
        const data = await resp.json()
        if (data.ok) {
          patch(it.id, { status: 'done', result: { vocab_correct: data.vocab_correct, vocab_total: data.vocab_total, missing: data.missing_numbers ?? [] } })
          onGraded(it.studentId!, data.vocab_correct, data.vocab_total, data.results)
        } else patch(it.id, { status: 'error', error: data.error ?? '채점 실패' })
      }, () => patch(it.id, { status: 'error', error: '네트워크 오류' }))
    })
    setPhase('done')
  }

  const doneCount = items.filter((it) => it.status === 'done').length
  const errorCount = items.filter((it) => it.status === 'error').length
  const isBusy = captureBusy || phase === 'matching' || phase === 'grading'

  /**
   * 닫기 요청 처리 (X · 바깥 클릭 · 취소 · Esc 공통).
   * - 채점 중이면 아예 안 닫힘 (요청은 이미 서버에서 돌고 있어 화면만 잃는다)
   * - 사진을 넣어둔 상태(매칭 확인 중)나 실패 건이 남은 상태면 confirm — 닫으면 목록이 사라진다
   * - 그 외(빈 상태, 전부 완료)는 바로 닫힘
   */
  function requestClose() {
    if (isBusy) return
    const pendingCount = items.filter((it) => it.status !== 'done').length
    if (items.length > 0 && pendingCount > 0) {
      const msg = phase === 'done'
        ? `채점하지 못한 답안지 ${errorCount}장이 있습니다. 완료된 ${doneCount}명의 결과는 유지됩니다.\n창을 닫으시겠습니까?`
        : `창을 닫으면 답안지 ${items.length}장의 학생 확인이 초기화됩니다.\n닫으시겠습니까?`
      if (!window.confirm(msg)) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) requestClose(); else onOpenChange(v) }}>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] rounded-[20px] shadow-none sm:max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">{phase === 'pick' ? '단어 답안지 등록' : phase === 'grading' ? '단어 채점' : phase === 'done' ? '채점 결과' : '학생 확인'}</DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            {phase === 'pick' && '답안지를 촬영하거나 사진을 추가해 주세요.'}
            {phase === 'matching' && '학생 이름을 인식하고 있습니다.'}
            {phase === 'review' && '답안지에 적힌 이름과 학생을 확인해 주세요. 모든 답안지를 확인하면 채점을 시작할 수 있습니다.'}
            {phase === 'grading' && `채점 중 ${doneCount + errorCount} / ${readyToGrade.length}`}
            {phase === 'done' && `완료 ${doneCount}명${errorCount > 0 ? ` · 실패 ${errorCount}명` : ''}`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5">
          <MobileCapture key={`vocab:${weekId}`} draftKey={`vocab:${weekId}`} active={open && phase === 'pick'} onConfirm={addFiles} onBusyChange={setCaptureBusy} />
          {/* 드롭존 — pick/review 단계에서 추가 가능 */}
          {(phase === 'pick' || phase === 'review') && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}
              onClick={async () => { if (pickFiles) await addFiles(await pickFiles(true)); else inputRef.current?.click() }}
              className={cn(
                'mb-4 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 text-center transition-colors',
                dragOver ? 'border-indigo-400 bg-indigo-50/60' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50',
              )}
            >
              <ImagePlus className="h-6 w-6 text-indigo-400" />
              <p className="text-sm font-medium text-gray-700">{items.length === 0 ? '답안지 사진 추가' : '사진 추가'}</p>
              <p className="text-xs text-gray-400">여러 장 선택 가능 · 학생당 답안지 1장</p>
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
            <div className="space-y-3">
              {items.map((it, index) => {
                const isDup = !!it.studentId && duplicateStudentIds.has(it.studentId)
                return (
                  <ExamStudentConfirmationCard key={it.id}
                    number={index + 1} previewUrl={it.previewUrl} mimeType={it.mimeType}
                    studentId={it.studentId} students={presentStudents} rawName={it.rawName}
                    confirmed={isExamStudentConfirmed(it, duplicateStudentIds)} duplicate={isDup}
                    disabled={isBusy || it.status === 'done'}
                    onStudentChange={(studentId) => patch(it.id, { studentId, confirmedStudentId: null })}
                    onConfirm={() => {
                      if ((phase === 'review' || phase === 'done') && it.studentId && !isDup) patch(it.id, { confirmedStudentId: it.studentId })
                    }}
                    onRemove={() => removeItem(it.id)}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {it.status === 'reading' && <span className="text-[var(--share-muted)]">이름 인식 중</span>}
                      {it.status === 'grading' && <><Loader2 className="size-3.5 animate-spin" /><span>채점 중</span></>}
                      {it.status === 'done' && it.result && (it.result.missing.length > 0
                        ? <><AlertTriangle className="size-3.5 text-[var(--share-red)]" /><span title={`미인식 문항: ${formatNumberRanges(it.result.missing)}`}>{it.result.vocab_correct}/{it.result.vocab_total} · 미인식 {it.result.missing.length}문항</span></>
                        : <><CheckCircle2 className="size-3.5 text-[var(--share-blue)]" /><span>{it.result.vocab_correct}/{it.result.vocab_total}</span></>)}
                      {it.status === 'error' && <><XCircle className="size-3.5 text-[var(--share-red)]" /><span role="alert" className="text-[var(--share-red)]">{it.error}</span></>}
                    </div>
                  </ExamStudentConfirmationCard>
                )
              })}
            </div>
          )}
        </div>
        {/* 하단 액션 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-gray-50/60 px-5 py-3">
          <p aria-live="polite" className="text-xs text-[var(--share-body)]">
            {phase === 'review' && (
              <>
                {confirmedCount} / {items.length}장 확인
                {unmatched > 0 && <span className="ml-2">· 학생 미선택 {unmatched}장</span>}
                {duplicateStudentIds.size > 0 && <span className="ml-2 text-[var(--share-red)]">· 학생 중복 {duplicateStudentIds.size}명</span>}
                {overwriteCount > 0 && <span className="ml-2 text-gray-500">· 재채점 {overwriteCount}명 · 교사 확정 답안 유지</span>}
              </>
            )}
            {phase === 'grading' && `${items.length}명 채점 중`}
            {phase === 'done' && errorCount > 0 && '채점하지 못한 답안지는 다시 시도할 수 있습니다.'}
          </p>
          <div className="flex items-center gap-2">
            {phase === 'done' && errorCount > 0 && (
              <Button size="sm" variant="outline" onClick={retryFailed} disabled={!allConfirmed}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                실패 {errorCount}건 재시도
              </Button>
            )}
            {phase === 'done' ? (
              <Button size="sm" onClick={requestClose}>닫기</Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" disabled={isBusy} onClick={requestClose}>취소</Button>
                <Button size="sm" variant="action" disabled={isBusy || phase !== 'review' || !allConfirmed} onClick={startGrading}>
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
