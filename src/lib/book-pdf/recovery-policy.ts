import type { BookVerification } from './types'
import type { PdfImportJob } from '../pdf-import/types'
import { oldMetadataRevision } from './academic-year'

/** Change only when a deployed recovery policy can address a previous hold. */
export const NATIVE_RECOVERY_REVISION = 2

export function needsUpdatedNativeRecovery(proof: BookVerification) {
  return proof.protocol === 2 && proof.status === 'unresolved' && proof.exhausted === true
    && (proof.recovery_revision ?? 1) < NATIVE_RECOVERY_REVISION
}

export function bookQualityRetryBlocked(job: Pick<PdfImportJob, 'kind' | 'result'>) {
  if (job.kind !== 'bank_book' || job.result?.verification_unresolved !== true) return false
  if (job.result.metadata_conflict === true && oldMetadataRevision(job.result.metadata_revision)) return false
  const revision = job.result.recovery_revision ?? 1
  return typeof revision !== 'number' || !Number.isInteger(revision) || revision >= NATIVE_RECOVERY_REVISION
}
