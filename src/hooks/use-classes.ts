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

export function useCreateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; description: string; start_date: string; end_date: string }) => {
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
    mutationFn: async ({ id, ...body }: { id: string; name: string; description: string; start_date: string; end_date: string }) => {
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
