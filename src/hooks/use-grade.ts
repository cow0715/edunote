import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export type GradeRow = {
  student_id: string
  student_name: string
  present: boolean
  vocab_correct: number
  reading_correct: number
  homework_done: number
  memo: string
  answers: { exam_question_id: string; student_answer: number | null; student_answer_text?: string; is_correct?: boolean; ai_feedback?: string }[]
}

export function useGradeData(weekId: string) {
  return useQuery({
    queryKey: ['grade', weekId],
    queryFn: async () => {
      const res = await fetch(`/api/weeks/${weekId}/grade`)
      if (!res.ok) throw new Error('채점 데이터 조회 실패')
      return res.json()
    },
  })
}

export function useSaveGrade(weekId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rows: GradeRow[]) => {
      const res = await fetch(`/api/weeks/${weekId}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rows),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['grade', weekId] })
      toast.success('채점이 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
