'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { ExamQuestion } from '@/lib/types'
import { useConceptCategories, useConceptTags } from '@/hooks/use-concept-tags'

interface Props {
  weekId: string
}

const STYLE_OPTIONS = [
  { value: 'objective',    label: '객관식',        desc: '1~5번 중 하나를 고르는 기본 형식' },
  { value: 'ox',           label: 'O/X 교정형',    desc: '틀린 부분을 찾아 고치는 형식' },
  { value: 'multi_select', label: '복수정답',       desc: '정답이 2개 이상인 객관식' },
  { value: 'subjective',   label: '서술형 (AI채점)', desc: '직접 쓰는 답을 AI가 채점' },
  { value: 'find_error',   label: '오류교정',       desc: '문장의 오류를 찾아 수정하는 형식' },
] as const

export function QuestionTypeEditor({ weekId }: Props) {
  const qc = useQueryClient()

  const { data: questions = [], isLoading } = useQuery<ExamQuestion[]>({
    queryKey: ['exam-questions', weekId],
    queryFn: async () => {
      const res = await fetch(`/api/weeks/${weekId}/questions`)
      if (!res.ok) throw new Error('조회 실패')
      return res.json()
    },
  })

  const { data: categories = [] } = useConceptCategories()
  const { data: allTags = [] } = useConceptTags()

  const [tagMap, setTagMap] = useState<Record<string, string[]>>({})
  const [styleMap, setStyleMap] = useState<Record<string, string>>({})
  const [answerMap, setAnswerMap] = useState<Record<string, { primary: number | null; extra: number[] }>>({})
  const [addState, setAddState] = useState<Record<string, { catId: string; tagId: string }>>({})

  const questionSnapshot = questions
    .map((q) => `${q.id}:${q.correct_answer}:${q.correct_answer_text}:${(q.exam_question_tag ?? []).map((t) => t.concept_tag?.id).sort().join(',')}`)
    .join('|')

  useEffect(() => {
    if (!questions.length) return
    const map: Record<string, string[]> = {}
    const sMap: Record<string, string> = {}
    const aMap: Record<string, { primary: number | null; extra: number[] }> = {}
    for (const q of questions) {
      map[q.id] = (q.exam_question_tag ?? [])
        .map((t) => t.concept_tag?.id)
        .filter((id): id is string => !!id)
      sMap[q.id] = q.question_style
      if (q.question_style === 'objective') {
        const extra = q.correct_answer_text
          ? q.correct_answer_text.split(',').map(Number).filter((n) => !isNaN(n) && n !== q.correct_answer)
          : []
        aMap[q.id] = { primary: q.correct_answer ?? null, extra }
      } else {
        aMap[q.id] = { primary: null, extra: [] }
      }
    }
    setTagMap(map)
    setStyleMap(sMap)
    setAnswerMap(aMap)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionSnapshot])

  const readingQuestions = questions.filter((q) => q.exam_type === 'reading')

  function addTag(questionId: string) {
    const tagId = addState[questionId]?.tagId
    if (!tagId) return
    setTagMap((prev) => {
      const existing = prev[questionId] ?? []
      if (existing.includes(tagId)) return prev
      return { ...prev, [questionId]: [...existing, tagId] }
    })
    setAddState((prev) => ({ ...prev, [questionId]: { catId: prev[questionId]?.catId ?? '', tagId: '' } }))
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
        return { ...prev, [questionId]: { ...cur, extra: cur.extra.filter((x) => x !== n) } }
      }
      if (cur.primary === null) {
        return { ...prev, [questionId]: { primary: n, extra: cur.extra } }
      }
      return { ...prev, [questionId]: { ...cur, extra: [...cur.extra, n] } }
    })
  }

  const save = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(tagMap).map(([id, concept_tag_ids]) => ({
        id,
        concept_tag_ids,
        question_style: styleMap[id],
        ...(styleMap[id] === 'objective' && answerMap[id] ? {
          correct_answer: answerMap[id].primary,
          extra_correct_answers: answerMap[id].extra,
        } : {}),
      }))
      const res = await fetch(`/api/weeks/${weekId}/questions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('저장 실패')
    },
    onSuccess: () => {
      setAddState({})
      qc.invalidateQueries({ queryKey: ['exam-questions', weekId] })
      qc.invalidateQueries({ queryKey: ['grade', weekId] })
      toast.success('문항 유형 저장 완료')
    },
    onError: () => toast.error('저장 실패'),
  })

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />

  if (readingQuestions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center">
        <p className="text-sm text-gray-400">해설지를 먼저 업로드해주세요</p>
      </div>
    )
  }

  const styleSelectContent = (
    <SelectContent>
      {STYLE_OPTIONS.map(({ value, label, desc }) => (
        <SelectItem key={value} value={value}>
          <div>
            <div className="text-xs font-medium">{label}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{desc}</div>
          </div>
        </SelectItem>
      ))}
    </SelectContent>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        형식은 채점 방식, 유형 태그는 출제 영역(독해·문법·어휘 등)을 나타냅니다. 한 문항에 태그를 여러 개 달 수 있습니다.
      </p>

      {/* ── 모바일 카드 ── */}
      <div className="space-y-2 md:hidden">
        {readingQuestions.map((q) => {
          const selectedTagIds = tagMap[q.id] ?? []
          const { catId = '', tagId = '' } = addState[q.id] ?? {}
          const tagsInCat = catId
            ? allTags.filter((t) => t.concept_category_id === catId && !selectedTagIds.includes(t.id))
            : []
          const ans = answerMap[q.id] ?? { primary: null, extra: [] }
          const effectiveStyle = styleMap[q.id] ?? q.question_style

          return (
            <div key={q.id} className="rounded-lg border bg-white p-3 space-y-3">
              <span className="font-medium text-sm">
                {q.question_number}번{q.sub_label ? ` (${q.sub_label})` : ''}
              </span>

              <div className="grid grid-cols-2 gap-3">
                {/* 정답 */}
                <div>
                  <p className="text-[11px] text-gray-400 mb-1.5">정답</p>
                  {effectiveStyle === 'objective' ? (
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => {
                        const isPrimary = ans.primary === n
                        const isExtra = ans.extra.includes(n)
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => toggleAnswer(q.id, n)}
                            className={[
                              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors',
                              isPrimary ? 'bg-indigo-600 text-white' :
                              isExtra   ? 'bg-amber-400 text-white' :
                                          'bg-gray-100 text-gray-400 hover:bg-gray-200',
                            ].join(' ')}
                          >
                            {n}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>

                {/* 형식 */}
                <div>
                  <p className="text-[11px] text-gray-400 mb-1.5">형식</p>
                  <Select
                    value={styleMap[q.id] ?? q.question_style}
                    onValueChange={(v) => setStyleMap((prev) => ({ ...prev, [q.id]: v }))}
                  >
                    <SelectTrigger className="h-7 w-full text-xs [&>span]:flex-1 [&>span]:text-center">
                      <SelectValue />
                    </SelectTrigger>
                    {styleSelectContent}
                  </Select>
                </div>
              </div>

              {/* 선택된 유형 */}
              <div>
                <p className="text-[11px] text-gray-400 mb-1.5">선택된 유형</p>
                <div className="flex flex-wrap gap-1 min-h-[1.5rem]">
                  {selectedTagIds.length === 0 && (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                  {selectedTagIds.map((tid) => {
                    const tag = allTags.find((t) => t.id === tid)
                    if (!tag) return null
                    return (
                      <span
                        key={tid}
                        className="inline-flex items-center gap-0.5 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
                      >
                        {tag.name}
                        <button
                          type="button"
                          onClick={() => removeTag(q.id, tid)}
                          className="ml-0.5 rounded-full text-indigo-400 hover:text-indigo-700"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* 유형 추가 */}
              <div>
                <p className="text-[11px] text-gray-400 mb-1.5">유형 추가</p>
                <div className="flex gap-1">
                  <Select
                    value={catId || 'none'}
                    onValueChange={(v) =>
                      setAddState((prev) => ({
                        ...prev,
                        [q.id]: { catId: v === 'none' ? '' : v, tagId: '' },
                      }))
                    }
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs">
                      <SelectValue placeholder="대분류" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={tagId || 'none'}
                    onValueChange={(v) =>
                      setAddState((prev) => ({
                        ...prev,
                        [q.id]: { catId: prev[q.id]?.catId ?? '', tagId: v === 'none' ? '' : v },
                      }))
                    }
                    disabled={!catId}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs">
                      <SelectValue placeholder={catId ? '중분류' : '대분류 먼저'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {tagsInCat.map((tag) => (
                        <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <button
                    type="button"
                    onClick={() => addTag(q.id)}
                    disabled={!tagId}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border text-sm font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── 데스크탑 테이블 ── */}
      <div className="hidden md:block overflow-x-auto rounded-lg border max-h-[55vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="w-16 px-3 py-2 text-left">번호</th>
              <th className="w-36 px-2 py-2 text-left">정답</th>
              <th className="w-32 px-2 py-2 text-left">형식</th>
              <th className="px-2 py-2 text-left">선택된 유형</th>
              <th className="w-64 px-2 py-2 text-left">유형 추가</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {readingQuestions.map((q) => {
              const selectedTagIds = tagMap[q.id] ?? []
              const { catId = '', tagId = '' } = addState[q.id] ?? {}
              const tagsInCat = catId
                ? allTags.filter((t) => t.concept_category_id === catId && !selectedTagIds.includes(t.id))
                : []
              const ans = answerMap[q.id] ?? { primary: null, extra: [] }
              const effectiveStyle = styleMap[q.id] ?? q.question_style

              return (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {q.question_number}번{q.sub_label ? ` (${q.sub_label})` : ''}
                  </td>

                  <td className="px-2 py-2">
                    {effectiveStyle === 'objective' ? (
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => {
                          const isPrimary = ans.primary === n
                          const isExtra = ans.extra.includes(n)
                          return (
                            <button
                              key={n}
                              type="button"
                              onClick={() => toggleAnswer(q.id, n)}
                              className={[
                                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors',
                                isPrimary ? 'bg-indigo-600 text-white' :
                                isExtra   ? 'bg-amber-400 text-white' :
                                            'bg-gray-100 text-gray-400 hover:bg-gray-200',
                              ].join(' ')}
                              title={isPrimary ? '주정답 (클릭 시 해제)' : isExtra ? '추가인정 (클릭 시 해제)' : '클릭해서 선택'}
                            >
                              {n}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>

                  <td className="px-2 py-2">
                    <Select
                      value={styleMap[q.id] ?? q.question_style}
                      onValueChange={(v) => setStyleMap((prev) => ({ ...prev, [q.id]: v }))}
                    >
                      <SelectTrigger className="h-7 w-full text-xs [&>span]:flex-1 [&>span]:text-center">
                        <SelectValue />
                      </SelectTrigger>
                      {styleSelectContent}
                    </Select>
                  </td>

                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {selectedTagIds.length === 0 && (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                      {selectedTagIds.map((tid) => {
                        const tag = allTags.find((t) => t.id === tid)
                        if (!tag) return null
                        return (
                          <span
                            key={tid}
                            className="inline-flex items-center gap-0.5 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
                          >
                            {tag.name}
                            <button
                              type="button"
                              onClick={() => removeTag(q.id, tid)}
                              className="ml-0.5 rounded-full text-indigo-400 hover:text-indigo-700"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  </td>

                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      <Select
                        value={catId || 'none'}
                        onValueChange={(v) =>
                          setAddState((prev) => ({
                            ...prev,
                            [q.id]: { catId: v === 'none' ? '' : v, tagId: '' },
                          }))
                        }
                      >
                        <SelectTrigger className="h-7 w-[7rem] text-xs">
                          <SelectValue placeholder="대분류" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={tagId || 'none'}
                        onValueChange={(v) =>
                          setAddState((prev) => ({
                            ...prev,
                            [q.id]: { catId: prev[q.id]?.catId ?? '', tagId: v === 'none' ? '' : v },
                          }))
                        }
                        disabled={!catId}
                      >
                        <SelectTrigger className="h-7 w-[7rem] text-xs">
                          <SelectValue placeholder={catId ? '중분류' : '대분류 먼저'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {tagsInCat.map((tag) => (
                            <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <button
                        type="button"
                        onClick={() => addTag(q.id)}
                        disabled={!tagId}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border text-sm font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                      >
                        +
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? '저장 중...' : '저장'}
        </Button>
      </div>
    </div>
  )
}
