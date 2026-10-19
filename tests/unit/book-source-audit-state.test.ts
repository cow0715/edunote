import { describe, expect, it } from 'vitest'
import { applySelectiveSourceRepair, sourceAuditErrors, sourceAuditEvidence, sourceDraftHash, sourceTargetValue, type SelectiveSourceRepair } from '@/lib/book-pdf/source-audit-state'
import { sourceAuditFixture } from '../fixtures/book-source-audit'
import { resolveSourceMap } from '@/lib/book-pdf/source-map'

describe('selective source repair', () => {
  it('makes one-based candidate answer semantics explicit without consulting expected answers', () => {
    const f = sourceAuditFixture(); f.draft[0].extraction.questions[0].answer = 5
    expect(sourceAuditEvidence(f.draft)[0].extraction.questions[0]).toMatchObject({ answer: 5, printed_answer_symbol: '⑤' })
    expect(f.mapping.groups[0].questions[0].answer).toEqual([{ s: 11, e: 11 }])
  })
  function repaired(text = 'Correct sentence.') {
    const f = sourceAuditFixture()
    const repair: SelectiveSourceRepair = { edits: [{ target: f.target, mode: 'text', text, pages: [9] }], issues: [] }
    return { ...f, repair, expectedHash: sourceDraftHash(f.draft) }
  }
  it('changes only the flagged field and preserves native data and source provenance', () => {
    const f = repaired(), original = structuredClone(f), result = applySelectiveSourceRepair(f)
    expect(result.draft[0].extraction.passage).toBe('Correct sentence.')
    expect(result.draft[0].extraction.questions).toEqual(f.draft[0].extraction.questions)
    expect(f).toEqual(original)
    expect(result.ledger[0]).toMatchObject({ before: 'Original sentence.', after: 'Correct sentence.', imageHashes: { 9: 'original-image-hash' } })
  })
  it('rejects an edit to an unflagged field', () => {
    const f = repaired(); f.repair.edits[0].target = { ...f.target, field: 'translation' }
    expect(() => applySelectiveSourceRepair(f)).toThrow('exactly the flagged')
  })
  it('rejects stale edits', () => {
    const f = repaired(); f.draft[0].extraction.passage = 'changed concurrently'
    expect(() => applySelectiveSourceRepair(f)).toThrow('Stale')
  })
  it('rejects duplicated and incomplete repair sets', () => {
    const f = repaired(); f.repair.edits.push(structuredClone(f.repair.edits[0]))
    expect(() => applySelectiveSourceRepair(f)).toThrow('exactly the flagged')
    f.repair.edits = []
    expect(() => applySelectiveSourceRepair(f)).toThrow('exactly the flagged')
  })
  it('rejects source images outside the flagged window', () => {
    const f = repaired(); if (f.repair.edits[0].mode === 'text') f.repair.edits[0].pages = [10]
    expect(() => applySelectiveSourceRepair(f)).toThrow('outside')
  })
  it('rejects executable markup in a re-extracted field', () => {
    expect(() => applySelectiveSourceRepair(repaired('<img src=x onerror=alert(1)>'))).toThrow('Unexpected markup')
  })
  it('preserves original underline and bold in a selective visual repair', () => {
    expect(applySelectiveSourceRepair(repaired('<strong><u>Correct</u></strong> sentence.')).draft[0].extraction.passage).toBe('<strong><u>Correct</u></strong> sentence.')
  })
  it('does not approve an inventory issue that has no repairable field address', () => {
    const f = repaired(); f.audit.issues[0].target = null; f.audit.issues[0].kind = 'inventory'
    expect(() => applySelectiveSourceRepair(f)).toThrow('unaddressable')
  })
  it('rejects a contradictory pass verdict', () => {
    const f = sourceAuditFixture(); f.audit.status = 'pass'
    expect(sourceAuditErrors(f.audit, f.draft, f.pages)).toContain('inconsistent_audit_pass')
  })
  it('rejects unknown group and choice addresses', () => {
    const f = sourceAuditFixture()
    expect(() => sourceTargetValue(f.draft, { ...f.target, g: 8 })).toThrow('Unknown')
    expect(() => sourceTargetValue(f.draft, { g: 0, q: 0, field: 'choice', choice: null })).toThrow('Unknown')
  })
  it('requires remapped ranges to preserve source ownership', () => {
    const f = repaired(); f.repair.edits = [{ target: f.target, mode: 'refs', refs: [{ s: 2, e: 2 }] }]
    expect(() => applySelectiveSourceRepair(f)).toThrow('native ownership')
  })
  it('does not remap to a page that was not identified by the reviewer', () => {
    const f = repaired(); f.pages.push({ ...f.pages[0], page: 10, lines: [{ ...f.pages[0].lines[0], id: 14, page: 10 }] })
    f.repair.edits = [{ target: f.target, mode: 'refs', refs: [{ s: 14, e: 14 }] }]
    expect(() => applySelectiveSourceRepair(f)).toThrow('outside the audited')
  })
  it('includes an existing field continuation page even when the typo occurs on its first page', () => {
    const f = repaired()
    f.pages.push({ ...f.pages[0], page: 10, lines: [{ ...f.pages[0].lines[0], id: 14, page: 10, text: 'Continuation.' }] })
    f.mapping.groups[0].passage.push({ s: 14, e: 14 })
    f.draft = resolveSourceMap(f.pages, f.mapping).groups; f.expectedHash = sourceDraftHash(f.draft)
    f.imageHashes = { ...f.imageHashes, ...{ 10: 'continuation-image' } }
    if (f.repair.edits[0].mode === 'text') { f.repair.edits[0].pages = [9, 10]; f.repair.edits[0].text = 'Correct sentence.\nContinuation.' }
    const r = applySelectiveSourceRepair(f)
    expect(r.draft[0].extraction.passage).toBe('Correct sentence.\nContinuation.')
    expect(r.ledger[0].imageHashes).toEqual({ 9: 'original-image-hash', 10: 'continuation-image' })
  })
  it('derives visual answer repairs from one printed symbol, not a generated explanation', () => {
    const f = repaired(); f.target = { g: 0, q: 0, field: 'answer', choice: null }; f.audit.issues[0].target = f.target
    f.repair.edits = [{ target: f.target, mode: 'text', text: '⑤', pages: [9] }]
    expect(applySelectiveSourceRepair(f).draft[0].extraction.questions[0].answer).toBe(5)
    if (f.repair.edits[0].mode === 'text') f.repair.edits[0].text = '② 또는 ⑤'
    expect(() => applySelectiveSourceRepair(f)).toThrow('exactly one')
  })
})
