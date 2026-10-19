import type { SupabaseClient } from '@supabase/supabase-js'

export type PdfJobProgress = { id: string; status: string; stage: string; completed_calls: number; can_retry?: boolean; lease_expires_at?: string | null; error?: string | null; result?: Record<string, unknown> | null }

/** Polling waits in the browser; every server request remains short. Existing 200 responses are supported. */
export async function resolvePdfImport(
  data: Record<string, unknown>, onProgress?: (job: PdfJobProgress) => void,
): Promise<Record<string, unknown>> {
  if (typeof data.job_id !== 'string') return data
  for (;;) {
    const response = await fetch(`/api/pdf-import/jobs/${encodeURIComponent(data.job_id)}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`작업 조회 실패. 작업 목록에서 확인해주세요. (${data.job_id})`)
    const job = await response.json() as PdfJobProgress
    onProgress?.(job)
    if (job.status === 'succeeded') return job.result ?? {}
    if (job.status === 'failed') throw new Error(`${job.error || 'PDF 처리 실패'} — 작업 목록에서 재실행할 수 있습니다.`)
    if (job.can_retry || (job.status === 'queued' && job.error) || (job.status === 'running' && job.lease_expires_at && Date.now() - new Date(job.lease_expires_at).getTime() > 30_000)) {
      throw new Error('워커 실행이 지연되거나 중단됐습니다. 작업 목록에서 상태를 확인하고 재실행해주세요.')
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
}

export async function examPdfUploadPath(client: SupabaseClient, fileName: string) {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new Error('로그인이 필요합니다.')
  return `${data.user.id}/${crypto.randomUUID()}_${fileName.replace(/[^\w.\-]/g, '_')}`
}
