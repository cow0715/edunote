import { describe, expect, it } from 'vitest'
import { bookFingerprint, bookProofMatches } from '@/lib/book-pdf/proof'
import { bindBookMapping, validateNativeBookUnit } from '@/lib/book-pdf/native-unit'
import { nativeFixture } from '../fixtures/book-native'
import { draft, extraction } from '../fixtures/book-pdf'
function nativeDraft() { const f = nativeFixture(); return { ...draft(), manifest:f.unit, verification:f.proof, enrichment:f.enrichment } }
describe('native image-audit publication proof', () => {
  it('accepts separate source-image reads using one model and a bound supplement', () => {
    expect(bookProofMatches(nativeDraft())).toBe(true)
  })
  it('requires images of every original page and a final fresh passing audit', () => {
    for (const mutate of [(u: ReturnType<typeof nativeDraft>) => { u.verification.audit!.image_hashes = {} },
      (u: ReturnType<typeof nativeDraft>) => { u.verification.audit!.last_status = 'repair' },
      (u: ReturnType<typeof nativeDraft>) => { u.verification.audit!.pages = [10] },
      (u: ReturnType<typeof nativeDraft>) => { u.verification.pipeline = undefined }]) {
      const u = nativeDraft(); mutate(u); expect(bookProofMatches(u)).toBe(false)
    }
  })
  it('rejects stale or modified enrichment and missing source keys', () => {
    const u = nativeDraft(); u.enrichment.questions[0].solution = 'changed'
    expect(bookProofMatches(u)).toBe(false)
    u.verification.enrichment_hash = bookFingerprint(u.enrichment)
    u.enrichment.source_hash = 'other source'
    u.verification.enrichment_hash = bookFingerprint(u.enrichment)
    expect(bookProofMatches(u)).toBe(false)
    const missing = nativeDraft(); missing.enrichment.questions = []; missing.verification.enrichment_hash = bookFingerprint(missing.enrichment)
    expect(bookProofMatches(missing)).toBe(false)
  })
  it('holds an answer disagreement even if the image reviewer passes', () => {
    const f = nativeFixture(), bad = structuredClone(extraction); bad.questions[0].answer = 4
    expect(validateNativeBookUnit(f.unit,bad).errors.join(' ')).toContain('정답')
  })
  it('does not bind unrelated source groups by array position', () => {
    const f = nativeFixture(); f.mapping.groups[0].questions[0].id = 'other'
    expect(() => bindBookMapping(f.unit,f.mapping)).toThrow('식별자')
    f.mapping.groups.push(f.mapping.groups[0])
    expect(() => bindBookMapping(f.unit,f.mapping)).toThrow('하나')
  })
})
