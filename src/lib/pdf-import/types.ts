export type PdfImportKind = 'bank_questions' | 'bank_explanation' | 'week_answers' | 'bank_book'
export type PdfImportStatus = 'queued' | 'running' | 'waiting_batch' | 'succeeded' | 'failed'

export type PdfImportJob = {
  id: string
  teacher_id: string
  kind: PdfImportKind
  target_id: string
  source_path: string
  payload: Record<string, unknown>
  status: PdfImportStatus
  stage: string
  completed_calls: number
  attempt: number
  lease_token: string | null
  lease_expires_at: string | null
  result: Record<string, unknown> | null
  error: string | null
  created_at: string
  updated_at: string
  resume_after?: string | null
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function workerEnabled() {
  return process.env.PDF_IMPORT_WORKER_ENABLED === 'true'
}
