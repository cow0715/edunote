import { z } from 'zod'
import type { PdfImportJob } from '../pdf-import/types'
import type { BookDraftUnit, BookVerification } from './types'

export const BOOK_FAILURE_POLICY = 'hold-first-failure-v1'
export const bookFailureStage = z.enum(['preparation', 'mapping', 'audit', 'enrichment'])
export type BookFailureStage = z.infer<typeof bookFailureStage>
export type BookFailure = { policy: typeof BOOK_FAILURE_POLICY; stage: BookFailureStage; attempt_id: string | null }
const failedUnit = z.object({ unit_key: z.string().regex(/^unit-\d+$/), source_hash: z.string().regex(/^[a-f0-9]{64}$/),
  stage: bookFailureStage, attempt_id: z.string().uuid().nullable(), labels: z.array(z.string()).min(1), reasons: z.array(z.string()).min(1) }).strict()
export type FailedBookUnit = z.infer<typeof failedUnit>
const resume = z.object({ id: z.string().uuid(), units: z.array(failedUnit.pick({ unit_key: true, source_hash: true, stage: true })).min(1).max(1000) }).strict()
export type BookFailureResume = z.infer<typeof resume>

export function bookFailures(result: Record<string, unknown> | null): FailedBookUnit[] {
  const parsed = z.array(failedUnit).max(1000).safeParse(result?.book_failures)
  return parsed.success && new Set(parsed.data.map(u => u.unit_key)).size === parsed.data.length ? parsed.data : []
}
export function bookResume(payload: Record<string, unknown>): BookFailureResume | null {
  if (payload.bookFailureResume === undefined) return null
  const parsed = resume.safeParse(payload.bookFailureResume)
  if (!parsed.success || new Set(parsed.data.units.map(u => u.unit_key)).size !== parsed.data.units.length) throw Error('보류 구간 재개 기록이 올바르지 않습니다.')
  return parsed.data
}
export function failedBookUnits(units: BookDraftUnit[]): FailedBookUnit[] {
  return units.flatMap(u => u.verification.failure?.policy === BOOK_FAILURE_POLICY && u.verification.status === 'unresolved'
    ? [{ unit_key: u.unit_key, source_hash: u.verification.source_hash, stage: u.verification.failure.stage,
      attempt_id: u.verification.failure.attempt_id, labels: u.manifest.questions.map(q => q.label), reasons: u.verification.issues.length ? u.verification.issues : ['처리 결과를 확정하지 못했습니다.'] }] : [])
}
export function heldBookUnit(proof: BookVerification, request: { id: string; stage: BookFailureStage } | undefined) {
  return proof.status === 'unresolved' && proof.failure?.policy === BOOK_FAILURE_POLICY
    && (!request || proof.failure.attempt_id === request.id || proof.failure.stage !== request.stage)
}
export function canResumeBookFailures(job: Pick<PdfImportJob, 'kind' | 'status' | 'result'>) {
  return job.kind === 'bank_book' && job.status === 'failed' && job.result?.manual_resume_only === true
    && job.result.batch_stopped !== true && job.result.batch_exhausted !== true && bookFailures(job.result).length > 0
}
