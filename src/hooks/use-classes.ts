import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Class, ClassPeriod } from '@/lib/types'
import { toast } from 'sonner'

async function fetchClasses(includeArchived = false): Promise<Class[]> {
  const res = await fetch(`/api/classes${includeArchived ? '?includeArchived=1' : ''}`)
  if (!res.ok) throw new Error('수업 목록 조회 실패')
  return res.json()
}

export function useClasses(includeArchived = false) {
  return useQuery({ queryKey: ['classes', includeArchived], queryFn: () => fetchClasses(includeArchived) })
}

export function useClass(classId: string) {
  return useQuery<Class>({
    queryKey: ['class', classId],
    queryFn: async () => {
      const res = await fetch(`/api/classes/${classId}`)
      if (!res.ok) throw new Error('수업 조회 실패')
      return res.json()
    },
    enabled: !!classId,
  })
}

export function useSyncWeeks(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/classes/${classId}/weeks/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['weeks', classId] })
      toast.success(`주차가 생성되었습니다 (총 ${data.total}회)`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useExtendWeeks(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (count: number) => {
      const res = await fetch(`/api/classes/${classId}/weeks/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['weeks', classId] })
      qc.invalidateQueries({ queryKey: ['class', classId] })
      toast.success(`${data.added}회 추가되었습니다`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useClassPeriods(classId: string) {
  return useQuery<ClassPeriod[]>({
    queryKey: ['class-periods', classId],
    queryFn: async () => {
      const res = await fetch(`/api/classes/${classId}/periods`)
      if (!res.ok) throw new Error('기간 조회 실패')
      return res.json()
    },
    enabled: !!classId,
  })
}

export function useCreateClassPeriod(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      label: string
      semester: 1 | 2
      exam_type: 'midterm' | 'final' | 'other'
      start_date: string
      end_date?: string | null
      is_current?: boolean
    }) => {
      const res = await fetch(`/api/classes/${classId}/periods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['class-periods', classId] })
      qc.invalidateQueries({ queryKey: ['weeks', classId] })
      toast.success('학습 기간이 생성되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useActivateClassPeriod(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (periodId: string) => {
      const res = await fetch(`/api/classes/${classId}/periods/${periodId}/activate`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['class-periods', classId] })
      qc.invalidateQueries({ queryKey: ['weeks', classId] })
      toast.success('현재 기간이 변경되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useCreateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      name: string
      description: string
      start_date: string
      end_date: string
      schedule_days: string[]
      academic_year?: number | null
      school_name?: string
      grade_level?: number | null
      period_label?: string
    }) => {
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error)
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes'] })
      toast.success('수업이 생성되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: {
      id: string
      name: string
      description: string
      start_date: string
      end_date: string
      schedule_days: string[]
      academic_year?: number | null
      school_name?: string
      grade_level?: number | null
    }) => {
      const res = await fetch(`/api/classes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error)
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes'] })
      toast.success('수업이 수정되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useArchiveClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archive }: { id: string; archive: boolean }) => {
      const res = await fetch(`/api/classes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived_at: archive ? new Date().toISOString() : null }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes'] })
      toast.success('수업 상태가 변경되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/classes/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes'] })
      toast.success('수업이 삭제되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
