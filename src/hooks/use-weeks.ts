import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Week, ExamQuestion } from '@/lib/types'
import { toast } from 'sonner'

export function useWeeks(classId: string) {
  return useQuery<Week[]>({
    queryKey: ['weeks', classId],
    queryFn: async () => {
      const res = await fetch(`/api/classes/${classId}/weeks`)
      if (!res.ok) throw new Error('주차 조회 실패')
      return res.json()
    },
  })
}

export function useCreateWeek(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/classes/${classId}/weeks`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weeks', classId] })
      toast.success('주차가 추가되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useAddWeekAtDate(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (date: string) => {
      const res = await fetch(`/api/classes/${classId}/weeks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: date }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weeks', classId] })
      toast.success('수업이 추가되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useMoveWeekDate(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ weekId, date }: { weekId: string; date: string }) => {
      // 1. 날짜 변경
      const moveRes = await fetch(`/api/weeks/${weekId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: date }),
      })
      if (!moveRes.ok) throw new Error((await moveRes.json()).error)

      // 2. 주차 번호 재정렬 (start_date 순)
      const reorderRes = await fetch(`/api/classes/${classId}/weeks/reorder`, { method: 'POST' })
      if (!reorderRes.ok) throw new Error((await reorderRes.json()).error)

      return reorderRes.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weeks', classId] })
      toast.success('수업일이 변경되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useWeek(weekId: string) {
  return useQuery<Week>({
    queryKey: ['week', weekId],
    queryFn: async () => {
      const res = await fetch(`/api/weeks/${weekId}`)
      if (!res.ok) throw new Error('주차 조회 실패')
      return res.json()
    },
  })
}

export function useUpdateWeek(weekId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { start_date: string; vocab_total: number; reading_total: number; homework_total: number }) => {
      const res = await fetch(`/api/weeks/${weekId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: (data: Week) => {
      qc.invalidateQueries({ queryKey: ['week', weekId] })
      qc.invalidateQueries({ queryKey: ['weeks', data.class_id] })
      toast.success('주차 정보가 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useExamQuestions(weekId: string) {
  return useQuery<ExamQuestion[]>({
    queryKey: ['exam-questions', weekId],
    queryFn: async () => {
      const res = await fetch(`/api/weeks/${weekId}/questions`)
      if (!res.ok) throw new Error('문항 조회 실패')
      return res.json()
    },
  })
}


