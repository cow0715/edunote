import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Attendance } from '@/lib/types'

export function useAttendance(classId: string, date: string) {
  return useQuery<Attendance[]>({
    queryKey: ['attendance', classId, date],
    queryFn: async () => {
      const res = await fetch(`/api/classes/${classId}/attendance?date=${date}`)
      if (!res.ok) throw new Error('출결 조회 실패')
      return res.json()
    },
    enabled: !!classId && !!date,
  })
}

export function useSaveAttendance(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      date: string
      records: { student_id: string; status: 'present' | 'late' | 'absent'; note?: string | null }[]
    }) => {
      const res = await fetch(`/api/classes/${classId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('출결 저장 실패')
      return res.json()
    },
    onSuccess: (_, { date }) => {
      qc.invalidateQueries({ queryKey: ['attendance', classId, date] })
    },
  })
}
