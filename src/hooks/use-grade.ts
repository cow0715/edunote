import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useState } from 'react'
import { createGradeSaveQueue, type GradeSaveQueue, type GradeSaveResult, type GradeVersion } from '@/lib/atomic-grade'

export type GradeRow = {
  grade_conflict?: boolean
  grade_version: GradeVersion
  student_id: string
  student_name: string
  present: boolean
  vocab_correct: number | null
  reading_present: boolean   // false = 시험 미응시 (reading_correct 강제 null)
  reading_correct: number | null
  homework_done: number | null
  memo: string
  /** Receipt for OCR applied during this editing session, not a historical photo link. */
  exam_photo_path?: string | null
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
    refetchOnWindowFocus: false, // 창 전환 시 자동 refetch로 인한 로컬 상태 리셋 방지
  })
}

async function saveRequest(weekId: string, method: string, body: unknown): Promise<GradeSaveResult> {
  const res = await fetch(`/api/weeks/${weekId}/grade`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '채점 저장 실패')
  return data
}

export function useSaveWeekScore(weekId: string, sharedQueue?: GradeSaveQueue, onSaved?: () => void) {
  const [localQueue] = useState(createGradeSaveQueue)
  const queue = sharedQueue ?? localQueue
  return useMutation({
    mutationFn: (row: Pick<GradeRow, 'student_id' | 'grade_version' | 'homework_done' | 'memo'>) =>
      queue.run([row], ([submitted]) => saveRequest(weekId, 'PATCH', submitted)),
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  })
}

// 모달 닫기 / 학생 이동 시 조용히 저장 (AI 채점 없음)
export function useSaveGradeDraft(weekId: string, sharedQueue?: GradeSaveQueue, onSaved?: () => void) {
  const [localQueue] = useState(createGradeSaveQueue)
  const queue = sharedQueue ?? localQueue
  return useMutation({
    mutationFn: (input: GradeRow[] | { rows: GradeRow[]; finalizePhotoJobId: string }) => {
      const { rows, finalizePhotoJobId } = Array.isArray(input) ? { rows: input, finalizePhotoJobId: undefined } : input
      return queue.run(rows, (submitted) => saveRequest(weekId, 'POST', {
        rows: submitted, skip_ai: true, finalizePhotoJobId,
      }))
    },
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSaveGrade(weekId: string, sharedQueue?: GradeSaveQueue, onSaved?: () => void) {
  const qc = useQueryClient()
  const [localQueue] = useState(createGradeSaveQueue)
  const queue = sharedQueue ?? localQueue
  return useMutation({
    mutationFn: (rows: GradeRow[]) => queue.run(rows, (submitted) => saveRequest(weekId, 'POST', { rows: submitted, skip_ai: false })),
    onSuccess: async () => {
      onSaved?.()
      await queue.idle()
      await qc.refetchQueries({ queryKey: ['grade', weekId] })
      toast.success('채점이 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
