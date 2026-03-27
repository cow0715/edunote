import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function usePrompt(key: string) {
  return useQuery<string | null>({
    queryKey: ['prompt', key],
    queryFn: async () => {
      const res = await fetch(`/api/prompts/${key}`)
      if (!res.ok) return null
      const { content } = await res.json()
      return content
    },
  })
}

export function useSavePrompt(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/prompts/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prompt', key] })
      toast.success('프롬프트가 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
