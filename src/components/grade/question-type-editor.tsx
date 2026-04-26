'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCheck, ChevronDown, ChevronUp, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConceptCategories, useConceptTags } from '@/hooks/use-concept-tags'
import { ExamQuestion } from '@/lib/types'

interface Props {
  weekId: string
}

type EditRow = {
  explanation: string
  correct_answer_text: string
  grading_criteria: string
  question_text: string
}

const STYLE_OPTIONS = [
  { value: 'objective', label: '객관식', desc: '1~5번 중 하나를 고르는 기본 형식' },
  { value: 'ox', label: 'O/X 교정형', desc: '옳고 그름 또는 수정형 답안을 받는 형식' },
  { value: 'multi_select', label: '복수정답', desc: '정답이 여러 개인 객관식 형식' },
  { value: 'subjective', label: '서술형', desc: '텍스트 답안을 받고 AI 채점이 필요한 형식' },
  { value: 'find_error', label: '오류교정', desc: '문장 수정 답안을 받는 형식' },
] as const

const STYLE_LABEL: Record<string, string> = {
  objective: '객관식',
  ox: 'O/X 교정형',
  multi_select: '복수정답',
  subjective: '서술형',
  find_error: '오류교정',
}

const ANSWER_TEXT_LABEL: Record<string, string> = {
  ox: '정답 텍스트',
  subjective: '모범답안',
  multi_select: '복수정답',
  find_error: '교정 정답',
}

function summarizeQuestion(questionText: string | null) {
  const firstLine = (questionText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine ?? '문제 텍스트가 아직 없습니다.'
}

function getQuestionDisplayText(questionText: string | null) {
  return questionText?.trim() || '문제 텍스트가 아직 없습니다.'
}

export function QuestionTypeEditor({ weekId }: Props) {
  const qc = useQueryClient()
  const { data: questions = [], isLoading } = useQuery<ExamQuestion[]>({
    queryKey: ['exam-questions', weekId],
    queryFn: async () => {
      const res = await fetch(`/api/weeks/${weekId}/questions`)
      if (!res.ok) throw new Error('문항 조회에 실패했습니다.')
      return res.json()
    },
  })

  const { data: categories = [] } = useConceptCategories()
  const { data: allTags = [] } = useConceptTags()

  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({})
  const [styleMap, setStyleMap] = useState<Record<string, string>>({})
  const [answerMap, setAnswerMap] = useState<Record<string, { primary: number | null; extra: number[] }>>({})
  const [voidMap, setVoidMap] = useState<Record<string, boolean>>({})
  const [allCorrectMap, setAllCorrectMap] = useState<Record<string, boolean>>({})
  const [addState, setAddState] = useState<Record<string, { catId: string; tagId: string }>>({})
  const [editMap, setEditMap] = useState<Record<string, EditRow>>({})

  const readingQuestions = useMemo(
    () => questions.filter((q) => q.exam_type === 'reading'),
    [questions],
  )
  const subjectiveOrderMap = useMemo(() => {
    const next: Record<string, number> = {}
    let order = 0

    for (const q of readingQuestions) {
      const style = styleMap[q.id] ?? q.question_style
      if (style !== 'subjective') continue
      order += 1
      next[q.id] = order
    }

    return next
  }, [readingQuestions, styleMap])

  const snapshot = readingQuestions
    .map((q) => `${q.id}:${q.question_style}:${q.correct_answer}:${q.correct_answer_text}:${q.explanation}:${q.grading_criteria}:${q.question_text}:${q.is_void}:${q.all_correct}:${(q.exam_question_tag ?? []).map((t) => t.concept_tag?.id).sort().join(',')}`)
    .join('|')

  useEffect(() => {
    if (!readingQuestions.length) return

    const nextTagMap: Record<string, string[]> = {}
    const nextStyleMap: Record<string, string> = {}
    const nextAnswerMap: Record<string, { primary: number | null; extra: number[] }> = {}
    const nextVoidMap: Record<string, boolean> = {}
    const nextAllCorrectMap: Record<string, boolean> = {}
    const nextEditMap: Record<string, EditRow> = {}

    for (const q of readingQuestions) {
      nextTagMap[q.id] = (q.exam_question_tag ?? [])
        .map((t) => t.concept_tag?.id)
        .filter((id): id is string => !!id)
      nextStyleMap[q.id] = q.question_style
      nextVoidMap[q.id] = q.is_void ?? false
      nextAllCorrectMap[q.id] = q.all_correct ?? false
      nextAnswerMap[q.id] = {
        primary: q.question_style === 'objective' ? (q.correct_answer ?? null) : null,
        extra: q.question_style === 'objective'
          ? (q.extra_correct_answers ?? []).filter((n) => n !== q.correct_answer)
          : [],
      }
      nextEditMap[q.id] = {
        explanation: q.explanation ?? '',
        correct_answer_text: q.correct_answer_text ?? '',
        grading_criteria: q.grading_criteria ?? '',
        question_text: q.question_text ?? '',
      }
    }

    setTagMap(nextTagMap)
    setStyleMap(nextStyleMap)
    setAnswerMap(nextAnswerMap)
    setVoidMap(nextVoidMap)
    setAllCorrectMap(nextAllCorrectMap)
    setEditMap(nextEditMap)
  }, [snapshot, readingQuestions])

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => (
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    ))
  }

  function setField(id: string, field: keyof EditRow, value: string) {
    setEditMap((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }))
  }

  function addTag(questionId: string) {
    const tagId = addState[questionId]?.tagId
    if (!tagId) return

    setTagMap((prev) => {
      const existing = prev[questionId] ?? []
      if (existing.includes(tagId)) return prev
      return { ...prev, [questionId]: [...existing, tagId] }
    })
    setAddState((prev) => ({
      ...prev,
      [questionId]: { catId: prev[questionId]?.catId ?? '', tagId: '' },
    }))
  }

  function removeTag(questionId: string, tagId: string) {
    setTagMap((prev) => ({
      ...prev,
      [questionId]: (prev[questionId] ?? []).filter((id) => id !== tagId),
    }))
  }

  function toggleAnswer(questionId: string, n: number) {
    setAnswerMap((prev) => {
      const cur = prev[questionId] ?? { primary: null, extra: [] }
      if (cur.primary === n) {
        const [next, ...rest] = cur.extra
        return { ...prev, [questionId]: { primary: next ?? null, extra: rest } }
      }
      if (cur.extra.includes(n)) {
        return { ...prev, [questionId]: { ...cur, extra: cur.extra.filter((value) => value !== n) } }
      }
      if (cur.primary === null) {
        return { ...prev, [questionId]: { primary: n, extra: cur.extra } }
      }
      return { ...prev, [questionId]: { ...cur, extra: [...cur.extra, n] } }
    })
  }

  const save = useMutation({
    mutationFn: async () => {
      const updates = readingQuestions.map((q) => {
        const editRow = editMap[q.id]
        const style = styleMap[q.id] ?? q.question_style

        return {
          id: q.id,
          concept_tag_ids: tagMap[q.id] ?? [],
          question_style: style,
          question_text: editRow?.question_text ?? null,
          explanation: editRow?.explanation ?? null,
          grading_criteria: style === 'subjective' ? (editRow?.grading_criteria || null) : null,
          correct_answer_text_override: style !== 'objective' ? (editRow?.correct_answer_text || null) : undefined,
          is_void: voidMap[q.id] ?? false,
          all_correct: allCorrectMap[q.id] ?? false,
          ...(style === 'objective' ? {
            correct_answer: answerMap[q.id]?.primary ?? null,
            extra_correct_answers: answerMap[q.id]?.extra ?? [],
          } : {}),
        }
      })

      const res = await fetch(`/api/weeks/${weekId}/questions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!res.ok) throw new Error('문항 저장에 실패했습니다.')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam-questions', weekId] })
      qc.invalidateQueries({ queryKey: ['grade', weekId] })
      toast.success('문항 정보를 저장했습니다.')
    },
    onError: () => {
      toast.error('문항 저장에 실패했습니다.')
    },
  })

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-[24px] bg-slate-100 dark:bg-slate-900/60" />
  }

  if (readingQuestions.length === 0) {
    return (
      <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/70 px-6 py-14 text-center text-sm text-slate-400 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-500">
        먼저 해설지나 문제지 PDF를 업로드해 문항을 가져와 주세요.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[20px] bg-slate-50/90 px-4 py-3 text-xs leading-5 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
        문항 번호, 문제 요약, 유형, 정답을 먼저 확인하고 필요한 문항만 펼쳐서 자세히 수정하세요.
        펼친 화면에서는 문제 전문, 해설, 서술형 정답, 채점 기준까지 한 번에 수정할 수 있습니다.
      </div>

      <div className="space-y-3">
        {readingQuestions.map((q) => {
          const style = styleMap[q.id] ?? q.question_style
          const editRow = editMap[q.id] ?? {
            explanation: '',
            correct_answer_text: '',
            grading_criteria: '',
            question_text: '',
          }
          const selectedTagIds = tagMap[q.id] ?? []
          const { catId = '', tagId = '' } = addState[q.id] ?? {}
          const tagsInCat = catId
            ? allTags.filter((tag) => tag.concept_category_id === catId && !selectedTagIds.includes(tag.id))
            : []
          const answer = answerMap[q.id] ?? { primary: null, extra: [] }
          const expanded = expandedIds.includes(q.id)
          const questionDisplayText = getQuestionDisplayText(editRow.question_text || q.question_text)
          const styleLabel = style === 'subjective'
            ? `서답형${subjectiveOrderMap[q.id] ?? ''}`
            : (STYLE_LABEL[style] ?? style)
          const answerSummary = style === 'objective'
            ? [answer.primary, ...(answer.extra ?? [])].filter((value): value is number => value !== null && value > 0).join(', ') || '미설정'
            : (editRow.correct_answer_text || q.correct_answer_text || '미설정')

          return (
            <div key={q.id} className="overflow-hidden rounded-[24px] bg-white/95 shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-900/90">
              <div className="flex items-start justify-between gap-3 px-4 py-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {q.question_number}번{q.sub_label ? ` (${q.sub_label})` : ''}
                    </span>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                      {styleLabel}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      정답: {answerSummary}
                    </span>
                    {voidMap[q.id] ? (
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 dark:bg-red-500/15 dark:text-red-300">
                        무효 문항
                      </span>
                    ) : null}
                    {allCorrectMap[q.id] ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                        전원 정답
                      </span>
                    ) : null}
                  </div>
                  <div className="rounded-[18px] bg-slate-50/80 px-3 py-2 text-sm leading-6 whitespace-pre-wrap break-words text-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
                    {questionDisplayText}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-0 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  onClick={() => toggleExpanded(q.id)}
                >
                  {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {expanded ? '접기' : '상세 수정'}
                </Button>
              </div>

              {expanded ? (
                <div className="space-y-4 border-t border-slate-100 bg-slate-50/40 px-4 py-4 dark:border-white/5 dark:bg-slate-950/20">
                  <div className="rounded-[20px] bg-blue-50/80 px-4 py-3 text-xs leading-5 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
                    <b className="font-semibold">사용법</b> 왼쪽에서 문제 원문과 해설을 확인하고, 오른쪽에서 유형·정답·태그만 빠르게 수정하세요.
                    객관식은 번호를 누르면 정답이 바뀌고, 서답형은 모범답안과 채점 기준을 함께 적어두면 AI 채점에 사용됩니다.
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
                    <div className="space-y-4 rounded-[22px] bg-white p-4 shadow-[0_10px_30px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-900/80">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">문제와 해설</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          시험지에서 읽힌 전체 문제를 그대로 확인하고, 필요하면 문장이나 보기를 직접 고칠 수 있습니다.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">문제 전문</label>
                        <Textarea
                          rows={12}
                          className="resize-y rounded-[18px] border-0 bg-slate-50/90 text-sm leading-6 shadow-inner dark:bg-slate-950/40"
                          value={editRow.question_text}
                          onChange={(event) => setField(q.id, 'question_text', event.target.value)}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">해설 / 오답 사유</label>
                        <Textarea
                          rows={5}
                          className="resize-y rounded-[18px] border-0 bg-slate-50/90 text-sm leading-6 shadow-inner dark:bg-slate-950/40"
                          value={editRow.explanation}
                          onChange={(event) => setField(q.id, 'explanation', event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-4 rounded-[22px] bg-white p-4 shadow-[0_10px_30px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-900/80">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">정답 설정</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          채점에 바로 반영되는 값입니다. 수정 후 하단의 저장 버튼을 눌러야 적용됩니다.
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">문항 형식</label>
                          <Select
                            value={style}
                            onValueChange={(value) => setStyleMap((prev) => ({ ...prev, [q.id]: value }))}
                          >
                            <SelectTrigger className="h-10 rounded-xl border-0 bg-slate-50 dark:bg-slate-900/70">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STYLE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  <div className="space-y-0.5">
                                    <div className="text-sm font-medium">{option.label}</div>
                                    <div className="text-[11px] text-slate-400">{option.desc}</div>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-6 sm:pt-0">
                          <button
                            type="button"
                            onClick={() => setVoidMap((prev) => ({ ...prev, [q.id]: !(prev[q.id] ?? false) }))}
                            className={[
                              'inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition-colors',
                              voidMap[q.id]
                                ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                                : 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:bg-slate-800 dark:text-slate-300',
                            ].join(' ')}
                          >
                            <Ban className="h-3.5 w-3.5" />
                            무효 문항
                          </button>
                          <button
                            type="button"
                            onClick={() => setAllCorrectMap((prev) => ({ ...prev, [q.id]: !(prev[q.id] ?? false) }))}
                            className={[
                              'inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium transition-colors',
                              allCorrectMap[q.id]
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 dark:bg-slate-800 dark:text-slate-300',
                            ].join(' ')}
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            전원 정답
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">정답</label>
                        {style === 'objective' ? (
                          <div className="flex flex-wrap gap-2">
                            {[1, 2, 3, 4, 5].map((value) => {
                              const isPrimary = answer.primary === value
                              const isExtra = answer.extra.includes(value)
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => toggleAnswer(q.id, value)}
                                  className={[
                                    'flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                                    isPrimary
                                      ? 'bg-blue-600 text-white'
                                      : isExtra
                                        ? 'bg-amber-400 text-white'
                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
                                  ].join(' ')}
                                >
                                  {value}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <Textarea
                            rows={3}
                            className="resize-y rounded-[18px] border-0 bg-slate-50/90 text-sm leading-6 shadow-inner dark:bg-slate-950/40"
                            placeholder={ANSWER_TEXT_LABEL[style] ?? '정답 텍스트'}
                            value={editRow.correct_answer_text}
                            onChange={(event) => setField(q.id, 'correct_answer_text', event.target.value)}
                          />
                        )}
                      </div>

                      {style === 'subjective' ? (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">채점 기준</label>
                          <Textarea
                            rows={4}
                            className="resize-y rounded-[18px] border-0 bg-slate-50/90 text-sm leading-6 shadow-inner dark:bg-slate-950/40"
                            value={editRow.grading_criteria}
                            onChange={(event) => setField(q.id, 'grading_criteria', event.target.value)}
                          />
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">문항 태그</label>
                        <div className="flex min-h-[2.5rem] flex-wrap gap-1.5 rounded-[18px] bg-slate-50/80 p-3 dark:bg-slate-900/60">
                          {selectedTagIds.length === 0 ? (
                            <span className="text-xs text-slate-400">아직 연결된 태그가 없습니다.</span>
                          ) : selectedTagIds.map((tagId) => {
                            const tag = allTags.find((item) => item.id === tagId)
                            if (!tag) return null
                            return (
                              <span
                                key={tagId}
                                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/15 dark:text-blue-300"
                              >
                                {tag.name}
                                <button type="button" onClick={() => removeTag(q.id, tagId)}>
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )
                          })}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                          <Select
                            value={catId || 'none'}
                            onValueChange={(value) => {
                              setAddState((prev) => ({
                                ...prev,
                                [q.id]: { catId: value === 'none' ? '' : value, tagId: '' },
                              }))
                            }}
                          >
                            <SelectTrigger className="h-10 rounded-xl border-0 bg-slate-50 dark:bg-slate-900/70">
                              <SelectValue placeholder="카테고리 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">선택 안 함</SelectItem>
                              {categories.map((category) => (
                                <SelectItem key={category.id} value={category.id}>
                                  {category.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Select
                            value={tagId || 'none'}
                            onValueChange={(value) => {
                              setAddState((prev) => ({
                                ...prev,
                                [q.id]: { catId, tagId: value === 'none' ? '' : value },
                              }))
                            }}
                          >
                            <SelectTrigger className="h-10 rounded-xl border-0 bg-slate-50 dark:bg-slate-900/70">
                              <SelectValue placeholder="태그 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">선택 안 함</SelectItem>
                              {tagsInCat.map((tag) => (
                                <SelectItem key={tag.id} value={tag.id}>
                                  {tag.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Button type="button" variant="outline" className="rounded-xl" onClick={() => addTag(q.id)}>
                            태그 추가
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex justify-end">
        <Button
          className="rounded-full bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? '저장 중...' : '문항 정보 저장'}
        </Button>
      </div>
    </div>
  )
}
