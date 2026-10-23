'use client'

import { questionLabel } from '@/lib/question-presentation'

import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ExamQuestion } from '@/lib/types'
import { GradeRow } from '@/hooks/use-grade'
import { StyleBadge } from './question-inputs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { FocusReview } from './focus-review'
import { buildReviewQueue, type ReviewDraft } from '@/lib/review-workflow'

import { cacheReviewDrafts, restoreReviewDrafts, removeCachedReviewDrafts } from '@/lib/review-draft-cache'

type Override = ReviewDraft

/**
 * 분류 순서: ⚠️ 검토 필요 → 오답 → 정답 → 미입력.
 * 저장 전 원본 상태로만 계산한다 — 판정 반영 상태로 정렬하면 버튼을 누르는 순간
 * 행이 아래로 튀어 목록이 재배열되는 사고가 있었다. 순서는 세션 내내 고정.
 */
function sortPriority(a: {
  answered: boolean
  originalNeedsReview: boolean
  originalIsCorrect: boolean | undefined
}): number {
  if (!a.answered) return 3
  if (a.originalNeedsReview) return 0
  if (a.originalIsCorrect === false) return 1
  if (a.originalIsCorrect === true) return 2
  return 3
}

export function SubjectiveReviewPanel({
  weekId,
  questions,
  rows,
}: {
  weekId: string
  questions: ExamQuestion[]
  rows: GradeRow[]
}) {
  const qc = useQueryClient()
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map())

  const subjectiveQuestions = questions.filter(
    (q) => q.question_style === 'subjective' || q.question_style === 'find_error'
  )

  const subjectiveIds = new Set(subjectiveQuestions.map((q) => q.id))
  const needsReviewTotal = rows.reduce(
    (n, r) => n + r.answers.filter((a) => a.needs_review && subjectiveIds.has(a.exam_question_id)).length, 0,
  )
  // 검토 대기 건이 있으면 그것만 모아 보여주는 게 기본 — 전체는 칩으로 전환
  const [filterChoice, setFilterChoice] = useState<'review' | 'all' | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const pendingLink = useRef<HTMLAnchorElement | null>(null)
  const allowNavigation = useRef(false)
  const [restoredCount, setRestoredCount] = useState(0)
  const [sessionWeek, setSessionWeek] = useState<string | null>(null)
  if (sessionWeek !== weekId) {
    setSessionWeek(weekId)
    const restored = restoreReviewDrafts(weekId, questions, rows)
    setOverrides(restored)
    setRestoredCount(restored.size)
    setFilterChoice(null)
    setFocusMode(false)
    setPendingHref(null)
  }
  const reviewQueue = buildReviewQueue(questions, rows)
  useEffect(() => { cacheReviewDrafts(weekId, overrides, questions, rows) }, [weekId, overrides, questions, rows])
  useEffect(() => {
    if (!overrides.size) return
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = '' }
    function protectLink(event: MouseEvent) {
      if (allowNavigation.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      const destination = new URL(link.href, location.href)
      if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return
      if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return
      event.preventDefault()
      event.stopImmediatePropagation()
      pendingLink.current = link
      setPendingHref(link.href)
    }
    document.addEventListener('click', protectLink, true)
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', protectLink, true) }
  }, [overrides.size])
  const onlyReview = (filterChoice ?? (needsReviewTotal > 0 ? 'review' : 'all')) === 'review'

  function getKey(studentId: string, questionId: string) {
    return `${studentId}_${questionId}`
  }

  // 정답/오답을 명시적으로 지정한다. 예전 토글(첫 클릭 = 무조건 정답)은
  // ⚠️ 를 치우다 OCR 깨진 답까지 전부 정답 확정되는 사고가 있어 버튼을 분리했다.
  function setVerdict(studentId: string, questionId: string, isCorrect: boolean, toggle = true) {
    if (confirm.isPending) return
    const key = getKey(studentId, questionId)
    setOverrides((prev) => {
      const next = new Map(prev)
      const existing = next.get(key)
      if (toggle && existing && existing.is_correct === isCorrect) next.delete(key) // 같은 버튼 재클릭 → 지정 해제
      else next.set(key, { student_id: studentId, exam_question_id: questionId, is_correct: isCorrect })
      return next
    })
  }

  const confirm = useMutation({
    mutationFn: async () => {
      const body = [...overrides.values()]
      if (body.length === 0) return
      const valid = restoreReviewDrafts(weekId, questions, rows)
      if (body.some(draft => valid.get(getKey(draft.student_id, draft.exam_question_id))?.is_correct !== draft.is_correct)) throw new Error('답안 또는 채점 기준이 변경되었습니다. 임시 판정을 취소한 뒤 다시 검토해 주세요.')
      const res = await fetch(`/api/weeks/${weekId}/grade-confirm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await res.json().catch(() => null)
      if (!res.ok) throw new Error(result?.error ?? '검토 결과를 저장하지 못했습니다. 다시 시도해 주세요.')
      if (result?.skipped?.length) throw new Error('일부 학생의 성적이 없어 모든 판정을 반영하지 못했습니다. 목록을 새로고침해 확인해 주세요.')
      return body
    },
    onSuccess: async (saved) => {
      removeCachedReviewDrafts(weekId, saved ?? [])
      await qc.refetchQueries({ queryKey: ['grade', weekId] })
      setOverrides(previous => {
        const next = new Map(previous)
        saved?.forEach(item => next.delete(getKey(item.student_id, item.exam_question_id)))
        return next
      })
      toast.success('검토 결과가 저장되었습니다')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (subjectiveQuestions.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-6">서술형 문항이 없습니다.</p>
  }

  const pendingCount = overrides.size

  return (
    <fieldset disabled={confirm.isPending} className="min-w-0 space-y-5">
      <Dialog open={pendingHref !== null} onOpenChange={open => { if (!open) setPendingHref(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>저장하지 않은 판정이 있습니다</DialogTitle><DialogDescription>임시 판정 {pendingCount}건은 성적에 반영되지 않았습니다. 이 탭에서 1시간 안에 돌아오면 변경되지 않은 답안의 판정을 복원합니다. 다른 화면으로 이동할까요?</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2"><Button type="button" className="min-h-11" variant="outline" onClick={() => setPendingHref(null)}>계속 검토</Button><Button type="button" className="min-h-11" onClick={() => {
            setPendingHref(null)
            const link = pendingLink.current
            if (link?.isConnected) { allowNavigation.current = true; try { link.click() } finally { allowNavigation.current = false } }
          }}>저장하지 않고 이동</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {restoredCount > 0 && pendingCount > 0 && <p role="status" className="text-sm text-muted-foreground">이동 전 임시 판정 {restoredCount}건을 복원했습니다. 저장해야 성적에 반영됩니다.</p>}
      {/* 헤더: 검토 대기 배지 + 필터 칩 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">서술형 검토</span>
          {needsReviewTotal > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
              검토 대기 {needsReviewTotal}건
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {([['review', `검토 필요${needsReviewTotal > 0 ? ` ${needsReviewTotal}` : ''}`], ['all', '전체']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={(onlyReview ? 'review' : 'all') === value}
              onClick={() => setFilterChoice(value)}
              className={cn(
                'min-h-11 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                (onlyReview ? 'review' : 'all') === value
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!focusMode && reviewQueue.length > 0 && <Button type="button" variant="outline" className="min-h-12 w-full sm:w-auto" onClick={() => setFocusMode(true)}>집중 검토 시작 ({reviewQueue.length}건)</Button>}
      {focusMode ? <FocusReview items={reviewQueue} drafts={overrides} saving={confirm.isPending}
        onDecide={(studentId, questionId, correct) => setVerdict(studentId, questionId, correct, false)}
        onSave={() => confirm.mutate()} onClose={() => setFocusMode(false)} /> : subjectiveQuestions.map((q) => {
        const studentRows = rows
          .filter((r) => r.present && r.reading_present)
          .map((r) => {
            const answer = r.answers.find((a) => a.exam_question_id === q.id)
            const key = getKey(r.student_id, q.id)
            const override = overrides.get(key)
            const isOverridden = !!override
            const isCorrect = isOverridden ? override.is_correct : answer?.is_correct
            const originalNeedsReview = answer?.needs_review ?? false
            const needsReview = isOverridden ? false : originalNeedsReview
            return {
              student_id: r.student_id,
              student_name: r.student_name,
              answered: !!(answer?.student_answer_text),
              student_answer_text: answer?.student_answer_text ?? '',
              is_correct: isCorrect,
              needs_review: needsReview,
              teacher_confirmed: isOverridden || (answer?.teacher_confirmed ?? false),
              ai_feedback: answer?.ai_feedback ?? '',
              isOverridden,
              originalNeedsReview,
              originalIsCorrect: answer?.is_correct,
            }
          })
          // "검토 필요만" 필터 — 저장 전 원본 needs_review 기준이라 판정을 내려도 목록에 남는다
          .filter((sr) => !onlyReview || sr.originalNeedsReview)
          .sort((a, b) => sortPriority(a) - sortPriority(b))

        const qLabel = questionLabel(q)

        if (studentRows.length === 0) return null

        return (
          <div key={q.id} className="rounded-lg border overflow-hidden">
            {/* 문항 헤더 */}
            <div className="bg-gray-50 px-4 py-3 border-b space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{qLabel}</span>
                <StyleBadge style={q.question_style} />
              </div>
              <p className="text-xs text-gray-600">
                모범답안: <span className="font-medium">{q.correct_answer_text}</span>
              </p>
              {q.grading_criteria && (
                <p className="text-xs text-gray-400 line-clamp-2">기준: {q.grading_criteria}</p>
              )}
            </div>

            {/* 학생 답안 테이블 */}
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50 text-xs text-gray-400 border-b">
                <tr>
                  <th className="px-4 py-2 text-left w-20">학생</th>
                  <th className="px-4 py-2 text-left">학생 답안</th>
                  <th className="px-4 py-2 text-left w-40">AI 피드백</th>
                  <th className="px-4 py-2 text-center w-24">결과</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {studentRows.map((sr) => (
                  <tr
                    key={sr.student_id}
                    className={cn(
                      'hover:bg-[var(--control-bg)]',
                      sr.needs_review && 'bg-amber-50/40'
                    )}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-700 whitespace-nowrap">
                      {sr.student_name}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {sr.student_answer_text || (
                        <span className="text-gray-300 text-xs">미입력</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{sr.ai_feedback}</td>
                    <td className="px-4 py-2.5 text-center">
                      {!sr.answered ? (
                        <span className="text-gray-300 text-xs">—</span>
                      ) : (() => {
                        const pending = sr.needs_review && !sr.isOverridden
                        const correctOn = !pending && sr.is_correct === true
                        const wrongOn = !pending && sr.is_correct === false
                        return (
                          <div
                            className={cn(
                              'inline-flex overflow-hidden rounded-full text-xs font-semibold transition-shadow',
                              pending ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : 'bg-gray-100/80'
                            )}
                          >
                            <button
                              type="button"
                              aria-label="정답"
                              title={sr.isOverridden && sr.is_correct ? '확정 해제' : '정답으로 확정'}
                              onClick={() => setVerdict(sr.student_id, q.id, true)}
                              className={cn(
                                'flex h-7 w-9 items-center justify-center transition-colors active:scale-95',
                                correctOn
                                  ? sr.isOverridden
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-emerald-100 text-emerald-600'
                                  : 'text-gray-300 hover:text-emerald-500'
                              )}
                            >
                              <Check className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                            <button
                              type="button"
                              aria-label="오답"
                              title={sr.isOverridden && !sr.is_correct ? '확정 해제' : '오답으로 확정'}
                              onClick={() => setVerdict(sr.student_id, q.id, false)}
                              className={cn(
                                'flex h-7 w-9 items-center justify-center transition-colors active:scale-95',
                                wrongOn
                                  ? sr.isOverridden
                                    ? 'bg-rose-500 text-white'
                                    : 'bg-rose-100 text-rose-500'
                                  : 'text-gray-300 hover:text-rose-500'
                              )}
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      {!focusMode && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">{pendingCount ? `미저장 판정 ${pendingCount}건 · 저장 전까지 성적에 반영되지 않습니다.` : '판정을 지정한 뒤 저장해 주세요.'}</p>
        {pendingCount > 0 && <Button type="button" variant="ghost" onClick={() => { if (window.confirm('저장하지 않은 판정을 모두 취소할까요?')) setOverrides(new Map()) }}>변경 모두 취소</Button>}
        <Button
          onClick={() => confirm.mutate()}
          disabled={confirm.isPending || pendingCount === 0}
          variant={pendingCount > 0 ? 'default' : 'outline'}
        >
          {confirm.isPending
            ? '저장 중...'
            : pendingCount > 0
              ? `검토 완료 저장 (${pendingCount}건)`
              : '변경 없음'}
        </Button>
      </div>}
    </fieldset>
  )
}
