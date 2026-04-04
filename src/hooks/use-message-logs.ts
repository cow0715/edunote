import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export type MessageLog = {
  id: string
  student_id: string
  week_id: string | null
  message: string
  sent_at: string
  student?: { id: string; name: string; mother_phone: string | null; father_phone: string | null; phone: string | null }
  week?: { id: string; week_number: number; class_id: string; class?: { id: string; name: string } } | null
}

export function useMessageLogs(studentId?: string) {
  return useQuery<MessageLog[]>({
    queryKey: ['message-logs', studentId ?? 'all'],
    queryFn: async () => {
      const url = studentId
        ? `/api/message-logs?student_id=${studentId}`
        : '/api/message-logs'
      const res = await fetch(url)
      if (!res.ok) throw new Error('조회 실패')
      return res.json()
    },
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
      toast.success('전송 내역이 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
