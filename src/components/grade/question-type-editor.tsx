'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
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

  // questionId → concept_tag_id
  const [tagMap, setTagMap] = useState<Record<string, string | null>>({})

  const questionSnapshot = questions.map((q) => `${q.id}:${q.concept_tag_id ?? ''}`).join(',')
  useEffect(() => {
    if (!questions.length) return
    const map: Record<string, string | null> = {}
    for (const q of questions) map[q.id] = q.concept_tag_id ?? null
    setTagMap(map)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionSnapshot])

  const readingQuestions = questions.filter((q) => q.exam_type === 'reading')

  // 태그 ID로 대분류 ID 조회
  function getCategoryId(tagId: string | null): string {
    if (!tagId) return 'none'
    return allTags.find((t) => t.id === tagId)?.concept_category_id ?? 'none'
  }

  function handleCategoryChange(questionId: string, catId: string) {
    // 대분류 바꾸면 중분류 초기화
    setTagMap((prev) => ({ ...prev, [questionId]: null }))
    // catId는 중분류 select 필터링에만 사용 (로컬 상태)
    setCatOverride((prev) => ({ ...prev, [questionId]: catId === 'none' ? null : catId }))
  }

  // 대분류 select 임시 선택값 (tagMap에서 유도하되, 사용자가 바꾸면 override)
  const [catOverride, setCatOverride] = useState<Record<string, string | null>>({})

  function getActiveCatId(questionId: string): string {
    if (questionId in catOverride) return catOverride[questionId] ?? 'none'
    return getCategoryId(tagMap[questionId] ?? null)
  }

  const save = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(tagMap).map(([id, concept_tag_id]) => ({ id, concept_tag_id }))
      const res = await fetch(`/api/weeks/${weekId}/questions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('저장 실패')
    },
    onSuccess: () => {
      setCatOverride({})
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
        AI가 자동으로 유형을 인식합니다. 잘못된 경우 직접 변경 후 저장하세요.
      </p>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="w-12 px-3 py-2 text-left">번호</th>
              <th className="w-14 px-2 py-2 text-left">정답</th>
              <th className="w-36 px-2 py-2 text-left">대분류</th>
              <th className="px-2 py-2 text-left">중분류</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {readingQuestions.map((q) => {
              const isSubjective = q.question_style === 'subjective'
              const activeCatId = getActiveCatId(q.id)
              const tagsInCat = activeCatId === 'none'
                ? []
                : allTags.filter((t) => t.concept_category_id === activeCatId)

              return (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-medium">{q.question_number}번</td>
                  <td className="px-2 py-1.5 text-gray-500 text-xs">
                    {isSubjective ? <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-600">서술형</span> : q.correct_answer}
                  </td>
                  <td className="px-2 py-1.5">
                    <Select value={activeCatId} onValueChange={(v) => handleCategoryChange(q.id, v)}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="대분류" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      value={tagMap[q.id] ?? 'none'}
                      onValueChange={(v) => {
                        setTagMap((prev) => ({ ...prev, [q.id]: v === 'none' ? null : v }))
                        // catOverride 제거 (태그에서 대분류 유도 가능)
                        setCatOverride((prev) => { const n = { ...prev }; delete n[q.id]; return n })
                      }}
                      disabled={activeCatId === 'none'}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder={activeCatId === 'none' ? '대분류 먼저' : '중분류'} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {tagsInCat.map((tag) => (
                          <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
