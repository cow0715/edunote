'use client'

import { memo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { Trash2, Copy, ChevronRight, Plus, Pencil, Loader2, BookOpen } from 'lucide-react'
import { QUESTION_TYPE_LABELS, DIFFICULTY_STYLE } from './constants'
import { MarkdownText, buildQuestionCopyText, buildQuestionCopyHtml, copyRich } from './markdown'
import { QuestionEditDialog } from './question-edit-dialog'
import type { ExamBankQuestion } from './types'

// ── 문항 목록 (펼침) ──────────────────────────────────────────────────────

export function QuestionList({ examId }: { examId: string }) {
  const queryClient = useQueryClient()
  const [editTarget, setEditTarget] = useState<ExamBankQuestion | null | 'new'>(null)

  const { data: questions, isLoading } = useQuery<ExamBankQuestion[]>({
    queryKey: ['exam-bank-questions', examId],
    queryFn: () => fetch(`/api/exam-bank/${examId}/questions`).then((r) => r.json()),
  })

  const deleteMutation = useMutation({
    mutationFn: (qid: string) =>
      fetch(`/api/exam-bank/${examId}/questions/${qid}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      toast.success('문항이 삭제되었습니다')
    },
  })

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-gray-400">{questions?.length ?? 0}문항</p>
        <Button size="sm" variant="outline" onClick={() => setEditTarget('new')}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          문항 추가
        </Button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">문항 로딩 중...</p>}
      {!isLoading && !questions?.length && <p className="text-sm text-gray-400">문항 없음</p>}

      <div className="space-y-3">
        {questions?.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            onEdit={() => setEditTarget(q)}
            onDelete={() => {
              if (confirm(`${q.question_number}번 문항을 삭제하시겠습니까?`)) {
                deleteMutation.mutate(q.id)
              }
            }}
          />
        ))}
      </div>

      <QuestionEditDialog
        examId={examId}
        target={editTarget}
        onClose={() => setEditTarget(null)}
      />
    </div>
  )
}

// ── 문항 카드 ─────────────────────────────────────────────────────────────

// memo: 검색 결과는 무한스크롤로 150개 이상 쌓이므로 체크박스 하나를 눌러도
// props 가 바뀐 카드(선택 토글된 1개)만 리렌더되도록 한다.
// 그러려면 부모가 내려주는 콜백은 안정적이어야 하고(useCallback), 선택 상태는
// Set 이 아닌 boolean 으로 내려야 한다.
export const QuestionCard = memo(function QuestionCard({
  question: q,
  showExamInfo,
  onEdit,
  onDelete,
  selectable,
  selected,
  onToggleSelect,
}: {
  question: ExamBankQuestion
  showExamInfo?: boolean
  onEdit?: () => void
  onDelete?: () => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const [showExplanation, setShowExplanation] = useState(false)
  const [editingExplanation, setEditingExplanation] = useState(false)
  const [expDraft, setExpDraft] = useState({
    intent: q.explanation_intent ?? '',
    translation: q.explanation_translation ?? '',
    solution: q.explanation_solution ?? '',
    vocabulary: q.explanation_vocabulary ?? '',
  })
  const queryClient = useQueryClient()
  const hasExplanation = !!(q.explanation_intent || q.explanation_translation || q.explanation_solution || q.explanation_vocabulary)

  const startEditExplanation = () => {
    setExpDraft({
      intent: q.explanation_intent ?? '',
      translation: q.explanation_translation ?? '',
      solution: q.explanation_solution ?? '',
      vocabulary: q.explanation_vocabulary ?? '',
    })
    setEditingExplanation(true)
    setShowExplanation(true)
  }

  // useMutation: try/finally 를 쓰면 React Compiler 가 이 memo 컴포넌트를 컴파일하지 않는다(finally 미지원).
  const saveExplanationMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/exam-bank/${q.exam_bank_id}/questions/${q.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          explanation_intent: expDraft.intent || null,
          explanation_translation: expDraft.translation || null,
          explanation_solution: expDraft.solution || null,
          explanation_vocabulary: expDraft.vocabulary || null,
        }),
      })
      if (!res.ok) throw new Error('저장 실패')
      await queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', q.exam_bank_id] })
    },
    onSuccess: () => setEditingExplanation(false),
    onError: () => toast.error('해설 저장에 실패했습니다'),
  })
  const expSaving = saveExplanationMutation.isPending
  const saveExplanation = () => saveExplanationMutation.mutate()

  // 시험 출처 레이블 (복사 헤더용)
  const examLabel = q.exam_bank
    ? `${q.exam_bank.exam_year}년 ${q.exam_bank.exam_month}월 고${q.exam_bank.grade} ${q.exam_bank.source} ${q.question_number}번`
    : `${q.question_number}번`

  const buildQuestionText = useCallback(() => {
    return buildQuestionCopyText(q, examLabel)
  }, [q, examLabel])

  const buildQuestionHtml = useCallback(() => {
    return buildQuestionCopyHtml(q, examLabel)
  }, [q, examLabel])

  const buildExplanationText = useCallback(() => {
    const header = q.exam_bank ? `[${examLabel} 해설]\n` : `[${q.question_number}번 해설]\n`
    const parts = [
      q.explanation_intent ? `[출제의도] ${q.explanation_intent}` : '',
      q.explanation_translation ? `[해석]\n${q.explanation_translation}` : '',
      q.explanation_solution ? `[풀이]\n${q.explanation_solution}` : '',
      q.explanation_vocabulary ? `[Words and Phrases]\n${q.explanation_vocabulary}` : '',
    ].filter(Boolean)
    return header + parts.join('\n\n')
  }, [q, examLabel])

  const buildExplanationHtml = useCallback(() => {
    const header = q.exam_bank ? `<p><strong>[${examLabel} 해설]</strong></p>` : `<p><strong>[${q.question_number}번 해설]</strong></p>`
    return header
      + (q.explanation_intent ? `<p><strong>[출제의도]</strong> ${q.explanation_intent}</p>` : '')
      + (q.explanation_translation ? `<p><strong>[해석]</strong><br>${q.explanation_translation.replace(/\n/g, '<br>')}</p>` : '')
      + (q.explanation_solution ? `<p><strong>[풀이]</strong><br>${q.explanation_solution}</p>` : '')
      + (q.explanation_vocabulary ? `<p><strong>[Words and Phrases]</strong><br>${q.explanation_vocabulary}</p>` : '')
  }, [q, examLabel])

  const copyQuestion = useCallback(async () => {
    await copyRich(buildQuestionText(), buildQuestionHtml())
    toast.success('문제 복사 완료')
  }, [buildQuestionText, buildQuestionHtml])

  const copyExplanation = useCallback(async () => {
    await copyRich(buildExplanationText(), buildExplanationHtml())
    toast.success('해설 복사 완료')
  }, [buildExplanationText, buildExplanationHtml])

  const copyBoth = useCallback(async () => {
    const plain = buildQuestionText() + '\n\n' + buildExplanationText()
    const html = buildQuestionHtml() + buildExplanationHtml()
    await copyRich(plain, html)
    toast.success('문제+해설 복사 완료')
  }, [buildQuestionText, buildQuestionHtml, buildExplanationText, buildExplanationHtml])

  const diffStyle = q.difficulty ? (DIFFICULTY_STYLE[q.difficulty] ?? DIFFICULTY_STYLE['중상']) : null

  // 정답 번호 (①→1, ②→2, ...)
  const answerIdx = q.answer ? ['①','②','③','④','⑤'].indexOf(q.answer) : -1

  // 선택률 인라인 표시 여부
  const hasChoiceRates = q.choice_rates && q.choice_rates.some((r) => r != null)

  return (
    <div className="rounded-2xl bg-white shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 선택 체크박스 */}
          {selectable && (
            <Checkbox
              checked={!!selected}
              onCheckedChange={() => onToggleSelect?.(q.id)}
              aria-label="선택"
              className="shrink-0"
            />
          )}
          {/* 문항번호 */}
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold shrink-0">
            {q.question_number}
          </span>
          {/* 유형 */}
          <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5">
            {QUESTION_TYPE_LABELS[q.question_type] || q.question_type}
          </span>
          {/* 난이도 칩 */}
          {diffStyle && (
            <span className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-0.5 ${diffStyle.bg} ${diffStyle.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${diffStyle.dot}`} />
              {q.difficulty}
            </span>
          )}
          {/* 배점 */}
          {q.points && (
            <span className="text-xs text-gray-400 font-medium">{q.points}점</span>
          )}
          {/* 정답률 */}
          {q.correct_rate != null && (
            <span className="text-xs text-blue-500 font-semibold">{q.correct_rate}%</span>
          )}
          {/* 출처 */}
          {showExamInfo && q.exam_bank && (
            <span className="text-xs text-gray-400">
              {q.exam_bank.exam_year}년 {q.exam_bank.exam_month}월 고{q.exam_bank.grade} {q.exam_bank.source}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 복사 드롭다운 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-0.5 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <Copy className="h-3.5 w-3.5" />
                <ChevronRight className="h-2.5 w-2.5 rotate-90" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-sm">
              <DropdownMenuItem onClick={copyQuestion}>문제만</DropdownMenuItem>
              <DropdownMenuItem onClick={copyExplanation} disabled={!hasExplanation}>
                해설만
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyBoth} disabled={!hasExplanation}>
                문제 + 해설
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onEdit && (
            <button onClick={onEdit} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* 발문 */}
        <p className="text-sm font-medium text-gray-800 leading-relaxed">
          <MarkdownText text={q.question_text} />
        </p>

        {/* 지문 */}
        {q.passage && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap text-justify">
              <MarkdownText text={q.passage} />
            </p>
          </div>
        )}

        {/* 선지 */}
        {q.choices.length > 0 && (
          <div className="space-y-1">
            {q.choices.map((c, i) => {
              const isAnswer = i === answerIdx
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    isAnswer ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600'
                  }`}
                >
                  <span className="shrink-0 break-words">{c}</span>
                  {/* 선지별 선택률 */}
                  {hasChoiceRates && q.choice_rates?.[i] != null && (
                    <span className={`ml-auto text-[11px] shrink-0 ${isAnswer ? 'text-blue-500 font-semibold' : 'text-gray-400'}`}>
                      {q.choice_rates[i]}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 해설 토글 */}
        <div className="flex items-center gap-2">
          {hasExplanation && (
            <button
              onClick={() => setShowExplanation(!showExplanation)}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {showExplanation ? '해설 접기' : '해설 보기'}
            </button>
          )}
          {!editingExplanation && (
            <button
              onClick={startEditExplanation}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 transition-colors"
            >
              <Pencil className="h-3 w-3" />
              해설 수정
            </button>
          )}
        </div>
        {showExplanation && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 space-y-2.5">
            {editingExplanation ? (
              <>
                {[
                  { key: 'intent', label: '출제의도' },
                  { key: 'translation', label: '해석' },
                  { key: 'solution', label: '풀이' },
                  { key: 'vocabulary', label: 'Words & Phrases' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">{label}</span>
                    <textarea
                      className="mt-0.5 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-gray-700 leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-amber-400"
                      rows={key === 'translation' ? 6 : key === 'vocabulary' ? 3 : 3}
                      value={expDraft[key as keyof typeof expDraft]}
                      onChange={(e) => setExpDraft((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveExplanation}
                    disabled={expSaving}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                  >
                    {expSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    저장
                  </button>
                  <button
                    onClick={() => setEditingExplanation(false)}
                    disabled={expSaving}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
                {q.explanation_intent && (
                  <div>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">출제의도</span>
                    <p className="text-sm text-gray-700 mt-0.5">{q.explanation_intent}</p>
                  </div>
                )}
                {q.explanation_translation && (
                  <div>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">해석</span>
                    <p className="text-sm text-gray-600 mt-0.5 leading-relaxed whitespace-pre-wrap">{q.explanation_translation}</p>
                  </div>
                )}
                {q.explanation_solution && (
                  <div>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">풀이</span>
                    <p className="text-sm text-gray-700 mt-0.5 leading-relaxed">{q.explanation_solution}</p>
                  </div>
                )}
                {q.explanation_vocabulary && (
                  <div>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Words &amp; Phrases</span>
                    <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">{q.explanation_vocabulary}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
