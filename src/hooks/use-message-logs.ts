import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const PAGE_SIZE = 30

export type MessageLog = {
  id: string
  student_id: string
  week_id: string | null
  message: string
  sent_at: string
  student?: { id: string; name: string; mother_phone: string | null; father_phone: string | null; phone: string | null }
  week?: { id: string; week_number: number; class_id: string; class?: { id: string; name: string } } | null
}

export function useMessageLogs(studentId: string) {
  return useQuery<MessageLog[]>({
    queryKey: ['message-logs', studentId],
    queryFn: async () => {
      const res = await fetch(`/api/message-logs?student_id=${studentId}`)
      if (!res.ok) throw new Error('조회 실패')
      return res.json()
    },
  })
}

export function useInfiniteMessageLogs() {
  return useInfiniteQuery({
    queryKey: ['message-logs-infinite'],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`/api/message-logs?limit=${PAGE_SIZE}&offset=${pageParam}`)
      if (!res.ok) throw new Error('조회 실패')
      const data = await res.json()
      return data as { logs: MessageLog[]; total: number }
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.logs.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    initialPageParam: 0,
  })
}

export function useSaveMessageLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { student_id: string; week_id: string; message: string }) => {
      const res = await fetch('/api/message-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['message-logs'] })
      qc.invalidateQueries({ queryKey: ['message-logs-infinite'] })
      toast.success('전송 내역이 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
