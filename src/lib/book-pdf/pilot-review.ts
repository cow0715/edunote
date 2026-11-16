import type { PdfImportJob } from '../pdf-import/types'
export function bookRecoveryExcluded(job: Pick<PdfImportJob, 'kind' | 'payload'>) {
  return job.kind === 'bank_book' && job.payload.recoveryExcluded === true
}
export function bookPilotAwaitingApproval(job: Pick<PdfImportJob, 'kind' | 'result'>) {
  return job.kind === 'bank_book' && job.result?.pilot_review_required === true && job.result?.pilot_review_approved !== true
}

export function bookReconciledRegistration(job?: Pick<PdfImportJob, 'kind' | 'result'>) {
  if (job?.kind !== 'bank_book' || job.result?.recovery_excluded !== true) return null
  const record = job.result.registration_reconciliation
  if (typeof record !== 'object' || record === null) return null
  const { bank_id: bankId, question_count: count } = record as Record<string, unknown>
  if (typeof bankId !== 'string' || !bankId || bankId !== job.result.registered_bank_id
    || typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) return null
  return { bankId, count }
}
