import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export type GradeRow = {
  student_id: string
  student_name: string
  present: boolean
  vocab_correct: number | null
  reading_present: boolean   // false = 시험 미응시 (reading_correct 강제 null)
  reading_correct: number | null
  homework_done: number | null
  memo: string
  answers: { exam_question_id: string; student_answer: number | null; student_answer_text?: string; ox_selection?: string | null; is_correct?: boolean; needs_review?: boolean; teacher_confirmed?: boolean; ai_feedback?: string }[]
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

export function useSaveWeekScore(weekId: string) {
  return useMutation({
    mutationFn: async ({ student_id, homework_done, memo }: { student_id: string; homework_done?: number | null; memo?: string }) => {
      const res = await fetch(`/api/weeks/${weekId}/grade`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id, homework_done, memo }),
      })
      if (!res.ok) throw new Error('저장 실패')
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
      if (!res.ok) {
        const text = await res.text()
        let msg = '채점 저장 실패'
        try { msg = JSON.parse(text).error ?? msg } catch { /* HTML 응답 등 */ }
        throw new Error(msg)
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.refetchQueries({ queryKey: ['grade', weekId] })
      if (data?.ai_grading_failed) {
        toast.warning(`채점 저장 완료 (서술형 AI 채점 실패: ${data.ai_error ?? '알 수 없는 오류'})`)
      } else {
        toast.success('채점이 저장되었습니다')
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
