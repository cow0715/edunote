import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QuestionType } from '@/lib/types'
import { toast } from 'sonner'

async function fetchQuestionTypes(): Promise<QuestionType[]> {
  const res = await fetch('/api/question-types')
  if (!res.ok) throw new Error('문제 유형 조회 실패')
  return res.json()
}

export function useQuestionTypes() {
  return useQuery({ queryKey: ['question-types'], queryFn: fetchQuestionTypes })
}

export function useCreateQuestionType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; sort_order: number }) => {
      const res = await fetch('/api/question-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['question-types'] }); toast.success('문제 유형이 추가되었습니다') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateQuestionType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name, sort_order }: { id: string; name: string; sort_order: number }) => {
      const res = await fetch(`/api/question-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sort_order }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['question-types'] }); toast.success('수정되었습니다') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteQuestionType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/question-types/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['question-types'] }); toast.success('삭제되었습니다') },
    onError: (e: Error) => toast.error(e.message),
  })
}
