import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ClinicAttendance, ClinicEnrollment, ClinicSlot, ClinicStudent, ClinicWeekday } from '@/lib/types'

export type ClinicOverview = {
  slots: ClinicSlot[]
  enrollments: ClinicEnrollment[]
  students: ClinicStudent[]
}

export type ClinicAttendanceResponse = {
  slot: ClinicSlot | null
  attendance: ClinicAttendance[]
  enrollments: ClinicEnrollment[]
}

export function useClinic() {
  return useQuery<ClinicOverview>({
    queryKey: ['clinic'],
    queryFn: async () => {
      const res = await fetch('/api/clinic')
      if (!res.ok) throw new Error((await res.json()).error ?? '보충수업 정보를 불러오지 못했습니다')
      return res.json()
    },
  })
}

export function useSaveClinicSlots() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (slots: {
      weekday: ClinicWeekday
      starts_at: string
      ends_at: string
      is_active: boolean
    }[]) => {
      const res = await fetch('/api/clinic/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '보충수업 요일 저장 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic'] })
      qc.invalidateQueries({ queryKey: ['clinic-attendance'] })
      toast.success('보충수업 요일이 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSaveClinicEnrollment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { student_id: string; clinic_slot_id: string | null; start_date?: string }) => {
      const res = await fetch('/api/clinic/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '보충수업 배정 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic'] })
      qc.invalidateQueries({ queryKey: ['clinic-attendance'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useClinicAttendance(date: string) {
  return useQuery<ClinicAttendanceResponse>({
    queryKey: ['clinic-attendance', date],
    queryFn: async () => {
      const res = await fetch(`/api/clinic/attendance?date=${encodeURIComponent(date)}`)
      if (!res.ok) throw new Error((await res.json()).error ?? '보충수업 출석 조회 실패')
      return res.json()
    },
    enabled: !!date,
  })
}

export function useSaveClinicAttendance(date: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      date: string
      clinic_slot_id: string
      records: { student_id: string; status: 'present' | 'absent' }[]
    }) => {
      const res = await fetch('/api/clinic/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '보충수업 출석 저장 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-attendance', date] })
      toast.success('보충수업 출석이 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
