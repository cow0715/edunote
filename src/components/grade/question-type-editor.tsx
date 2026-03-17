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

  // questionId → 선택된 tagId[]
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({})
  // questionId → 현재 "추가" 드롭다운 상태 { catId, tagId }
  const [addState, setAddState] = useState<Record<string, { catId: string; tagId: string }>>({})

  const questionSnapshot = questions
    .map((q) => `${q.id}:${(q.exam_question_tag ?? []).map((t) => t.concept_tag?.id).sort().join(',')}`)
    .join('|')

  useEffect(() => {
    if (!questions.length) return
    const map: Record<string, string[]> = {}
    for (const q of questions) {
      map[q.id] = (q.exam_question_tag ?? [])
        .map((t) => t.concept_tag?.id)
        .filter((id): id is string => !!id)
    }
    setTagMap(map)
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

  const save = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(tagMap).map(([id, concept_tag_ids]) => ({ id, concept_tag_ids }))
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        AI가 자동으로 유형을 인식합니다. 한 문항에 유형을 여러 개 태그할 수 있습니다.
      </p>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="w-12 px-3 py-2 text-left">번호</th>
              <th className="w-14 px-2 py-2 text-left">정답</th>
              <th className="px-2 py-2 text-left">선택된 유형</th>
              <th className="w-72 px-2 py-2 text-left">유형 추가</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {readingQuestions.map((q) => {
              const isSubjective = q.question_style === 'subjective'
              const selectedTagIds = tagMap[q.id] ?? []
              const { catId = '', tagId = '' } = addState[q.id] ?? {}
              const tagsInCat = catId
                ? allTags.filter((t) => t.concept_category_id === catId && !selectedTagIds.includes(t.id))
                : []

              return (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{q.question_number}번</td>
                  <td className="px-2 py-2 text-gray-500 text-xs">
                    {isSubjective
                      ? <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-600">서술형</span>
                      : q.correct_answer}
                  </td>

                  {/* 선택된 태그 pills */}
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

                  {/* 태그 추가 드롭다운 */}
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
                        <SelectTrigger className="h-7 w-28 text-xs">
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
                        <SelectTrigger className="h-7 w-28 text-xs">
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
                        className="flex h-7 w-7 items-center justify-center rounded border text-sm font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-30"
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
