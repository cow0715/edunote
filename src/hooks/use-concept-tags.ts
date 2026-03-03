import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConceptCategory, ConceptTag } from '@/lib/types'
import { toast } from 'sonner'

// ── Categories ──────────────────────────────────────────

export function useConceptCategories() {
  return useQuery<ConceptCategory[]>({
    queryKey: ['concept-categories'],
    queryFn: async () => {
      const res = await fetch('/api/concept-categories')
      if (!res.ok) throw new Error('조회 실패')
      return res.json()
    },
  })
}

export function useCreateConceptCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; sort_order: number }) => {
      const res = await fetch('/api/concept-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['concept-categories'] }); toast.success('대분류 추가됨') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateConceptCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name: string; sort_order: number }) => {
      const res = await fetch(`/api/concept-categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['concept-categories'] }); toast.success('수정됨') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteConceptCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/concept-categories/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['concept-categories'] })
      qc.invalidateQueries({ queryKey: ['concept-tags'] })
      toast.success('대분류 삭제됨')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ── Tags ────────────────────────────────────────────────

export function useConceptTags() {
  return useQuery<ConceptTag[]>({
    queryKey: ['concept-tags'],
    queryFn: async () => {
      const res = await fetch('/api/concept-tags')
      if (!res.ok) throw new Error('조회 실패')
      return res.json()
    },
  })
}

export function useCreateConceptTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { name: string; concept_category_id: string | null; sort_order: number }) => {
      const res = await fetch('/api/concept-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['concept-tags'] }); toast.success('태그 추가됨') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateConceptTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name: string; concept_category_id: string | null; sort_order: number }) => {
      const res = await fetch(`/api/concept-tags/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['concept-tags'] }); toast.success('수정됨') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteConceptTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/concept-tags/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['concept-tags'] }); toast.success('태그 삭제됨') },
    onError: (e: Error) => toast.error(e.message),
  })
}
