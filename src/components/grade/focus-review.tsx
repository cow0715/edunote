'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { ReviewDraft, ReviewQueueItem } from '@/lib/review-workflow'

export function FocusReview({ items, drafts, saving, onDecide, onSave, onClose }: {
  items: ReviewQueueItem[]
  drafts: Map<string, ReviewDraft>
  saving: boolean
  onDecide: (studentId: string, questionId: string, correct: boolean) => void
  onSave: () => void
  onClose: () => void
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const region = useRef<HTMLElement>(null)
  useEffect(() => { region.current?.focus() }, [])
  const index = Math.max(0, items.findIndex(item => item.key === activeKey))
  const item = items[index]
  const decided = items.filter(candidate => drafts.has(candidate.key)).length
  const remaining = items.length - decided

  function move(direction: number) {
    if (!saving && items.length) setActiveKey(items[(index + direction + items.length) % items.length].key)
  }
  function decide(correct: boolean) {
    if (saving || !item) return
    onDecide(item.studentId, item.question.id, correct)
    // Visit the next undecided answer; reviewed answers stay available via Previous/Next.
    for (let offset = 1; offset < items.length; offset++) {
      const next = items[(index + offset) % items.length]
      if (!drafts.has(next.key)) { setActiveKey(next.key); return }
    }
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (saving || event.repeat || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      if (drafts.size) onSave()
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === '1' || event.key === '2') { event.preventDefault(); decide(event.key === '1') }
    if (event.key.toLowerCase() === 'j' || event.key === 'ArrowDown') { event.preventDefault(); move(1) }
    if (event.key.toLowerCase() === 'k' || event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
  }

  return (
    <section ref={region} tabIndex={0} aria-label="집중 검토" onKeyDown={keyDown}
      className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">집중 검토</h3>
          <p role="status" aria-live="polite" className="mt-1 text-sm text-muted-foreground">
            {items.length ? `판정 ${decided}/${items.length}건 · 남은 답안 ${remaining}건` : '판정할 검토 답안이 없습니다.'}
          </p>
        </div>
        <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={saving}>목록으로</Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">판정은 임시로 표시됩니다. 검토 완료 저장을 눌러야 성적에 반영됩니다.</p>
      {item && <>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <strong>{item.question.question_number}번{item.question.sub_label ? ` (${item.question.sub_label})` : ''} · {item.studentName}</strong>
          <span className="text-muted-foreground">{index + 1} / {items.length}번째 답안</span>
        </div>
        {item.question.question_stem && <p className="whitespace-pre-wrap text-sm text-foreground">{item.question.question_stem}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-muted p-4"><h4 className="text-xs font-semibold text-muted-foreground">학생 답안</h4><p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed">{item.answer}</p></div>
          <div className="rounded-xl bg-muted p-4"><h4 className="text-xs font-semibold text-muted-foreground">모범답안</h4><p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed">{item.question.correct_answer_text || '모범답안 미등록'}</p></div>
        </div>
        {item.question.grading_criteria && <details key={`${item.key}-criteria`} className="rounded-xl border p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">채점 기준</summary><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.question.grading_criteria}</p></details>}
        {item.feedback && <details key={`${item.key}-feedback`} className="rounded-xl border p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">기존 AI 피드백</summary><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.feedback}</p></details>}
        {remaining === 0 && <p className="text-sm font-medium text-primary">모든 답안에 판정을 지정했습니다. 저장 전 이전·다음으로 다시 확인할 수 있습니다.</p>}
      </>}
      <div className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:px-0">
        {item && <>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" className="min-h-12" variant={drafts.get(item.key)?.is_correct === true ? 'default' : 'outline'} aria-pressed={drafts.get(item.key)?.is_correct === true} disabled={saving} onClick={() => decide(true)}>정답으로 판정</Button>
            <Button type="button" variant="outline" aria-pressed={drafts.get(item.key)?.is_correct === false} className={`min-h-12 ${drafts.get(item.key)?.is_correct === false ? 'border-destructive text-destructive' : ''}`} disabled={saving} onClick={() => decide(false)}>오답으로 판정</Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" className="min-h-11" variant="ghost" disabled={saving || items.length < 2} onClick={() => move(-1)}>이전 답안</Button>
            <Button type="button" className="min-h-11" variant="ghost" disabled={saving || items.length < 2} onClick={() => move(1)}>다음 답안</Button>
          </div>
        </>}
        <Button type="button" variant="action" className="min-h-12 w-full" disabled={saving || drafts.size === 0} onClick={onSave}>{saving ? '저장 중...' : drafts.size ? `검토 완료 저장 (${drafts.size}건)` : '변경 없음'}</Button>
      </div>
      <p className="hidden text-xs leading-relaxed text-muted-foreground sm:block">이 영역 안에서 단축키: 1 정답 · 2 오답 · J/K 다음/이전 · Ctrl 또는 ⌘+Enter 저장</p>
    </section>
  )
}
