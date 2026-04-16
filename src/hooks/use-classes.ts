import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Class } from '@/lib/types'
import { toast } from 'sonner'

async function fetchClasses(): Promise<Class[]> {
  const res = await fetch('/api/classes')
  if (!res.ok) throw new Error('수업 목록 조회 실패')
  return res.json()
}

export function useClasses() {
  return useQuery({ queryKey: ['classes'], queryFn: fetchClasses })
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

export function useCreateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; description: string; start_date: string; end_date: string; schedule_days: string[] }) => {
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
    mutationFn: async ({ id, ...body }: { id: string; name: string; description: string; start_date: string; end_date: string; schedule_days: string[] }) => {
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
