import { describe, expect, it } from 'vitest'
import { bookQualityRetryBlocked, needsUpdatedNativeRecovery, NATIVE_RECOVERY_REVISION } from '@/lib/book-pdf/recovery-policy'
import { nativeFixture } from '../fixtures/book-native'

describe('versioned textbook recovery', () => {
  it('retries old native holds only after recovery policy changes', () => {
    const proof = { ...nativeFixture().proof, status: 'unresolved' as const, exhausted: true }
    expect(needsUpdatedNativeRecovery(proof)).toBe(true)
    expect(needsUpdatedNativeRecovery({ ...proof, recovery_revision: NATIVE_RECOVERY_REVISION })).toBe(false)
    expect(needsUpdatedNativeRecovery({ ...proof, status: 'passed' })).toBe(false)
  })
  it('blocks repeated and malformed quality retries while retaining transient retries', () => {
    const job = { kind: 'bank_book' as const, result: { verification_unresolved: true } }
    expect(bookQualityRetryBlocked(job)).toBe(false)
    for (const recovery_revision of [NATIVE_RECOVERY_REVISION, NATIVE_RECOVERY_REVISION + 1, 'bad']) {
      expect(bookQualityRetryBlocked({ ...job, result: { ...job.result, recovery_revision } })).toBe(true)
    }
    expect(bookQualityRetryBlocked({ kind: 'bank_questions', result: job.result })).toBe(false)
    expect(bookQualityRetryBlocked({ kind: 'bank_book', result: null })).toBe(false)
  })
  it('reopens only the old metadata gate without reopening paid quality holds', () => {
    const job={kind:'bank_book' as const,result:{verification_unresolved:true,recovery_revision:NATIVE_RECOVERY_REVISION,metadata_conflict:true}}
    expect(bookQualityRetryBlocked(job)).toBe(false)
    expect(bookQualityRetryBlocked({...job,result:{...job.result,metadata_revision:2}})).toBe(true)
    expect(bookQualityRetryBlocked({...job,result:{...job.result,metadata_revision:'bad'}})).toBe(true)
    expect(bookQualityRetryBlocked({...job,result:{...job.result,metadata_conflict:false}})).toBe(true)
  })
})
