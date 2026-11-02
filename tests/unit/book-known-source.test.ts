import { describe, expect, it, vi } from 'vitest'
import { extraction } from '../fixtures/book-pdf'
import { nativeFixture } from '../fixtures/book-native'
import corrections from '@/lib/book-pdf/known-source-corrections.json'
import { bookSourceArchiveMatches, bookSourceProofMatches } from '@/lib/book-pdf/proof'
import * as policyModule from '@/lib/book-pdf/known-source-policy'
const { correctKnownSource, knownSourcePolicy, KNOWN_SOURCE_POLICIES, KNOWN_SOURCE_REVISION } = policyModule
describe('known source cache quarantine',()=>{
  for(const [index,policy] of KNOWN_SOURCE_POLICIES.entries())it(`keeps ${policy.label} archive intact but rejects its old approval`,()=>{
    const source=structuredClone(extraction)
    if(index===0) for(const edit of corrections.typeEdits) {
      const text=edit.patches.map(p=>p.before).join('\n')
      if(edit.field==='translation')source.translation=text;else source.questions[0].solution=text
    }
    else { source.questions[0].intent='미리 형성된 좋은 기업 평판의 효과';source.questions.push({...source.questions[0],key:'shared-2',intent:''}) }
    const before=JSON.stringify(source)
    expect(knownSourcePolicy(policy.pdfHash,policy.sourceHash)).toEqual(policy)
    const candidate=correctKnownSource(policy,source,policy.baseHash)
    expect(candidate.replayed).toBe(true)
    expect(candidate.extraction).not.toEqual(source)
    expect(JSON.stringify(source)).toBe(before)
    if(index===0){expect(candidate.extraction.translation).toContain('주장하는데, 그 이유는 그들');expect(candidate.extraction.questions[0].solution).toContain('자연스럽다. 따라서')}
    else expect(candidate.extraction.questions[1].intent).toBe(candidate.extraction.questions[0].intent)
  })
  it('does not guess edits for a changed preimage or quarantine an unrelated PDF',()=>{
    const policy=KNOWN_SOURCE_POLICIES[0]
    expect(correctKnownSource(policy,extraction,'f'.repeat(64))).toEqual({extraction,replayed:false})
    expect(knownSourcePolicy('f'.repeat(64),policy.sourceHash)).toBeUndefined()
  })
  it('requires a fresh bound audit after a policy revision',()=>{
    const f=nativeFixture(),spy=vi.spyOn(policyModule,'knownSourcePolicy').mockReturnValue(KNOWN_SOURCE_POLICIES[0])
    try {
      expect(bookSourceArchiveMatches(f.proof,extraction,f.unit)).toBe(true)
      expect(bookSourceProofMatches(f.proof,extraction,f.unit)).toBe(false)
      expect(bookSourceProofMatches({...f.proof,source_revision:KNOWN_SOURCE_REVISION},{...extraction,translation:'changed'},f.unit)).toBe(false)
    } finally {spy.mockRestore()}
  })
})
