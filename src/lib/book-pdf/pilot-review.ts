import type { PdfImportJob } from '../pdf-import/types'
export function bookRecoveryExcluded(job: Pick<PdfImportJob, 'kind' | 'payload'>) {
  return job.kind === 'bank_book' && job.payload.recoveryExcluded === true
}
export function bookPilotAwaitingApproval(job: Pick<PdfImportJob, 'kind' | 'result'>) {
  return job.kind === 'bank_book' && job.result?.pilot_review_required === true && job.result?.pilot_review_approved !== true
}
