'use client'
import { useQuery } from '@tanstack/react-query'
import type { PdfImportKind, PdfImportStatus } from '@/lib/pdf-import/types'

export type ImportJob = { id: string; kind: PdfImportKind; target_id: string; status: PdfImportStatus; stage: string; completed_calls: number; attempt: number;
  error: string | null; can_retry: boolean; result: Record<string, unknown> | null; display_title?: string; created_at?: string; updated_at?: string; resume_after?: string | null;
  progress?: { total: number; completed: number; questions: number } }
export function isActiveImport(job: Pick<ImportJob, 'status'>) { return ['queued', 'running', 'waiting_batch'].includes(job.status) }
export function usePdfImportJobs(weekId?: string) {
  return useQuery<ImportJob[]>({ queryKey: ['pdf-import-jobs', weekId ?? 'bank'], queryFn: async () => {
    const response = await fetch(`/api/pdf-import/jobs${weekId ? `?weekId=${encodeURIComponent(weekId)}` : ''}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('처리 내역을 불러오지 못했습니다. 다시 시도해주세요.')
    return response.json()
  }, refetchInterval: (q) => q.state.data?.some(isActiveImport) ? 5_000 : 30_000 })
}
