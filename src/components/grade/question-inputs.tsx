'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ExamQuestion } from '@/lib/types'
import { cn } from '@/lib/utils'

// ── 객관식 버튼 ────────────────────────────────────────
export const ObjectiveInput = memo(function ObjectiveInput({
  value, onChange, disabled,
}: { value: number | null; onChange: (n: number | null) => void; disabled: boolean }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === n ? null : n)}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
            value === n ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
})

// ── OX 입력 ────────────────────────────────────────────
export const OXInput = memo(function OXInput({
  textValue, onChange, disabled,
}: { textValue: string; onChange: (t: string) => void; disabled: boolean }) {
  const upper = textValue.trim().toUpperCase()
  const isO = upper === 'O'
  const isX = upper.startsWith('X')
  const currentCorr = isX ? textValue.trim().slice(1).trim() : ''
  const [rememberedCorr, setRememberedCorr] = useState(currentCorr)
  useEffect(() => {
    if (currentCorr) setRememberedCorr(currentCorr)
  }, [currentCorr])

  function selectO() { onChange('O') }
  function selectX() { onChange(rememberedCorr ? `X ${rememberedCorr}` : 'X') }
  function onCorrectionChange(v: string) {
    setRememberedCorr(v)
    onChange(v ? `X ${v}` : 'X')
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={isO ? () => onChange('') : selectO}
        className={cn(
          'flex h-8 w-10 items-center justify-center rounded-md text-sm font-bold transition-colors',
          isO ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        )}
      >O</button>
      <button
        type="button"
        disabled={disabled}
        onClick={isX ? () => onChange('') : selectX}
        className={cn(
          'flex h-8 w-10 items-center justify-center rounded-md text-sm font-bold transition-colors',
          isX ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        )}
      >X</button>
      {isX && (
        <Input
          value={currentCorr}
          onChange={(e) => onCorrectionChange(e.target.value)}
          disabled={disabled}
          placeholder="수정어"
          className="h-8 w-28 text-sm"
        />
      )}
      {isO && rememberedCorr && (
        <span className="text-xs text-gray-300 truncate max-w-24">{rememberedCorr}</span>
      )}
    </div>
  )
})

// ── 문항 유형 배지 ─────────────────────────────────────
export function StyleBadge({ style }: { style: ExamQuestion['question_style'] }) {
  const map = {
    objective:    { label: '객관식', cls: 'bg-gray-100 text-gray-500' },
    ox:           { label: 'O/X',   cls: 'bg-blue-50 text-blue-600' },
    subjective:   { label: '서술형', cls: 'bg-amber-50 text-amber-600' },
    multi_select: { label: '복수',  cls: 'bg-purple-50 text-purple-600' },
    find_error:   { label: '오류교정', cls: 'bg-rose-50 text-rose-600' },
  }
  const { label, cls } = map[style] ?? { label: style, cls: 'bg-gray-100 text-gray-500' }
  return <span className={cn('inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium shrink-0', cls)}>{label}</span>
}

// ── 그룹 문항 행 (sub_label a/b/c 가로 배치) ───────────
export const GroupedQuestionRow = memo(function GroupedQuestionRow({
  questions, answers, disabled, onChangeAnswer,
}: {
  questions: ExamQuestion[]
  answers: Array<{ exam_question_id: string; student_answer: number | null; is_correct?: boolean } | undefined>
  disabled: boolean
  onChangeAnswer: (questionId: string, n: number | null) => void
}) {
  const first = questions[0]
  const anyWrong = questions.some((_, i) => answers[i]?.is_correct === false)

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className={cn('text-sm font-medium', anyWrong ? 'text-red-400' : 'text-gray-700')}>
          문제 {first.question_number}
        </span>
        <StyleBadge style={first.question_style} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {questions.map((q, i) => {
          const answer = answers[i]
          const hasAnswer = answer?.student_answer !== null && answer?.student_answer !== undefined
          const isWrong = hasAnswer && answer?.is_correct === false
          return (
            <div key={q.id} className="flex items-center gap-1.5">
              <span className={cn('text-xs font-medium w-5 shrink-0', isWrong ? 'text-red-400' : 'text-gray-500')}>
                ({q.sub_label})
              </span>
              <ObjectiveInput
                value={answer?.student_answer ?? null}
                onChange={(n) => onChangeAnswer(q.id, n)}
                disabled={disabled}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})

// ── 문항 행 ────────────────────────────────────────────
export const QuestionRow = memo(function QuestionRow({
  q, answer, disabled, onChangeAnswer, onChangeText,
}: {
  q: ExamQuestion
  answer: { student_answer: number | null; student_answer_text?: string; is_correct?: boolean; needs_review?: boolean; ai_feedback?: string } | undefined
  disabled: boolean
  onChangeAnswer: (n: number | null) => void
  onChangeText: (t: string) => void
}) {
  const label = `${q.question_number}${q.sub_label ? ` (${q.sub_label})` : ''}`
  const isSubjective = q.question_style === 'subjective' || q.question_style === 'find_error'
  const hasAnswer = (answer?.student_answer !== null && answer?.student_answer !== undefined) || !!answer?.student_answer_text
  const isWrong = answer?.is_correct === false
  const needsReview = answer?.needs_review === true

  // 서술형 로컬 state — 타이핑은 로컬에서만, 부모 sync는 onBlur에만
  const externalText = answer?.student_answer_text ?? ''
  const [localText, setLocalText] = useState(externalText)
  const prevExternalRef = useRef(externalText)
  useEffect(() => {
    if (prevExternalRef.current !== externalText) {
      setLocalText(externalText)
      prevExternalRef.current = externalText
    }
  }, [externalText])

  return (
    <div className={cn('px-4 py-3', isSubjective ? 'flex flex-col gap-2' : 'flex items-center gap-3')}>
      <div className="flex items-center gap-1.5 shrink-0 w-24">
        <span className={cn('text-sm font-medium', isWrong ? 'text-red-400 line-through' : 'text-gray-700')}>
          문제 {label}
        </span>
        <StyleBadge style={q.question_style} />
      </div>
      <div className="flex-1">
        {q.question_style === 'objective' && (
          <ObjectiveInput value={answer?.student_answer ?? null} onChange={onChangeAnswer} disabled={disabled} />
        )}
        {q.question_style === 'ox' && (() => {
          const savedText = answer?.student_answer_text?.trim() ?? ''
          const isAnsweredX = savedText.toUpperCase().startsWith('X')
          const enteredCorrection = isAnsweredX ? savedText.slice(1).trim() : ''
          return (
            <div className="flex flex-col gap-1.5">
              <OXInput textValue={savedText} onChange={onChangeText} disabled={disabled} />
              {savedText && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 shrink-0">학생 답:</span>
                  <span className={cn(
                    'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                    answer?.is_correct ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-500'
                  )}>
                    {isAnsweredX ? `X${enteredCorrection ? ` → ${enteredCorrection}` : ''}` : savedText}
                    {' '}{answer?.is_correct ? '✓' : '✗'}
                  </span>
                </div>
              )}
            </div>
          )
        })()}
        {q.question_style === 'multi_select' && (
          <Input
            value={answer?.student_answer_text ?? ''}
            onChange={(e) => onChangeText(e.target.value)}
            disabled={disabled}
            placeholder={`예: ${q.correct_answer_text ?? '1,3'}`}
            className="h-8 w-36 text-sm"
          />
        )}
        {q.question_style === 'subjective' && (() => {
          const isSymbolCorr = !!q.correct_answer_text && /^[a-z]:.+$/i.test(q.correct_answer_text.trim())
          const placeholder = isSymbolCorr
            ? `수정어만 입력 (예: ${q.correct_answer_text!.split(':')[1]?.trim()})`
            : '답안 입력'
          return (
            <Textarea
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              onBlur={() => onChangeText(localText)}
              disabled={disabled}
              placeholder={placeholder}
              rows={2}
              className="text-sm resize-none"
            />
          )
        })()}
        {q.question_style === 'find_error' && (() => {
          const correction = q.correct_answer_text?.split(':')[1]?.trim() ?? ''
          return (
            <Textarea
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              onBlur={() => onChangeText(localText)}
              disabled={disabled}
              placeholder={correction ? `수정어 입력 (예: ${correction})` : '수정어 입력'}
              rows={2}
              className="text-sm resize-none"
            />
          )
        })()}
      </div>
      {isSubjective && hasAnswer && answer?.is_correct !== undefined && (
        <div className="flex items-center gap-2 flex-wrap">
          {needsReview ? (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 shrink-0">
              ⚠️ 검토 필요
            </span>
          ) : (
            <span className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
              answer.is_correct ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-500'
            )}>
              {answer.is_correct ? '✓ 정답' : '✗ 오답'}
            </span>
          )}
          {answer.ai_feedback && (
            <span className="text-xs text-gray-400">{answer.ai_feedback}</span>
          )}
        </div>
      )}
      {!isSubjective && q.correct_answer_text && (
        <span className="text-xs text-gray-300 shrink-0">정답: {q.correct_answer_text}</span>
      )}
    </div>
  )
})
