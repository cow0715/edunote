import { describe, expect, it } from 'vitest'
import { BOOK_FAILURE_POLICY, bookFailures, bookResume, canResumeBookFailures, failedBookUnits, heldBookUnit } from '@/lib/book-pdf/failure-policy'
import { nativeFixture } from '../fixtures/book-native'
import { draft } from '../fixtures/book-pdf'
import type { BookVerification } from '@/lib/book-pdf/types'
const id = '11111111-1111-4111-8111-111111111111'
const failure = { unit_key: 'unit-1', source_hash: 'a'.repeat(64), stage: 'audit' as const, labels: ['1강 1번'], reasons: ['원문 불일치'], attempt_id: null }
describe('textbook failure-only resume policy', () => {
  it('requires a held unit and a new explicit attempt for the exact failed stage', () => {
    const proof: BookVerification = { ...nativeFixture().proof, status: 'unresolved', failure: { policy: BOOK_FAILURE_POLICY, stage: 'audit', attempt_id: id } }
    expect(heldBookUnit(proof, undefined)).toBe(true)
    expect(heldBookUnit(proof, { id, stage: 'audit' })).toBe(true)
    expect(heldBookUnit(proof, { id: 'new', stage: 'enrichment' })).toBe(true)
    expect(heldBookUnit(proof, { id: 'new', stage: 'audit' })).toBe(false)
    expect(heldBookUnit({ ...proof, status: 'passed' }, undefined)).toBe(false)
  })
  it('rejects malformed/duplicate resume identities and diagnostic entries', () => {
    expect(bookResume({})).toBeNull()
    expect(() => bookResume({ bookFailureResume: { id: 'auto', units: [failure] } })).toThrow()
    const unit = { unit_key: failure.unit_key, source_hash: failure.source_hash, stage: failure.stage }
    expect(() => bookResume({ bookFailureResume: { id, units: [unit, unit] } })).toThrow()
    expect(bookResume({ bookFailureResume: { id, units: [unit] } })).toEqual({ id, units: [unit] })
    expect(bookFailures({ book_failures: [failure, failure] })).toEqual([])
    expect(bookFailures({ book_failures: [{ ...failure, stage: 'invalid' }] })).toEqual([])
  })
  it('reports labels and actual reasons without inventing failures for accepted or unattempted units', () => {
    const unit = draft(), proof: BookVerification = { ...unit.verification, status: 'unresolved', failure: { policy: BOOK_FAILURE_POLICY, stage: 'audit', attempt_id: null } }
    const failed = { ...unit, verification: { ...proof, issues: ['단어 누락'] } }
    expect(failedBookUnits([unit, failed])).toHaveLength(1)
    expect(failedBookUnits([failed])[0]).toMatchObject({ stage: 'audit', labels: unit.manifest.questions.map(q => q.label), reasons: ['단어 누락'] })
    const job = { kind: 'bank_book' as const, status: 'failed' as const, result: { manual_resume_only: true, book_failures: [failure] } }
    expect(canResumeBookFailures(job)).toBe(true)
    expect(canResumeBookFailures({ ...job, status: 'waiting_batch' })).toBe(false)
    expect(canResumeBookFailures({ ...job, kind: 'bank_questions' })).toBe(false)
    expect(canResumeBookFailures({ ...job, result: { ...job.result, batch_stopped: true } })).toBe(false)
  })
})
