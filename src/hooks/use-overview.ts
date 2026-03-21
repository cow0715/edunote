import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Student, Week } from '@/lib/types'

export interface OverviewScore {
  student_id: string
  week_id: string
  vocab_correct: number | null
  reading_correct: number | null
  homework_done: number | null
}

export interface OverviewAttendance {
  student_id: string
  date: string
  status: 'present' | 'late' | 'absent'
}

export interface ClassOverview {
  students: { student_id: string; student: Student }[]
  weeks: Week[]
  scores: OverviewScore[]
  attendance: OverviewAttendance[]
}

export function useClassOverview(classId: string) {
  return useQuery<ClassOverview>({
    queryKey: ['class-overview', classId],
    queryFn: async () => {
      const res = await fetch(`/api/classes/${classId}/overview`)
      if (!res.ok) throw new Error('현황 조회 실패')
      return res.json()
    },
    enabled: !!classId,
  })
}

export interface TeacherMemo {
  id: string
  student_id: string
  teacher_id: string
  content: string
  created_at: string
}

export function useTeacherMemos(studentId: string) {
  return useQuery<TeacherMemo[]>({
    queryKey: ['teacher-memos', studentId],
    queryFn: async () => {
      const res = await fetch(`/api/students/${studentId}/memos`)
      if (!res.ok) throw new Error('메모 조회 실패')
      return res.json()
    },
    enabled: !!studentId,
  })
}

export function useCreateMemo(studentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/students/${studentId}/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-memos', studentId] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteMemo(studentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (memoId: string) => {
      const res = await fetch(`/api/students/${studentId}/memos/${memoId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-memos', studentId] }),
    onError: (e: Error) => toast.error(e.message),
  })
}
