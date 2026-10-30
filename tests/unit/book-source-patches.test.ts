import { describe, expect, it } from 'vitest'
import { applySelectiveSourceRepair, applySourceTextPatches, compactSourceRepairSchema, sourceDraftHash, type SelectiveSourceRepair } from '@/lib/book-pdf/source-audit-state'
import { sourceAuditFixture } from '../fixtures/book-source-audit'

function fixture(before = 'Original', after = 'Correct') {
  const f = sourceAuditFixture(), expectedHash = sourceDraftHash(f.draft)
  const repair: SelectiveSourceRepair = { base_hash: expectedHash, edits: [{ target: f.target, mode: 'patch', patches: [{ before, after }], pages: [9] }], issues: [] }
  return { ...f, expectedHash, repair }
}

describe('anchored textbook source patches', () => {
  it('applies only the changed span, with unchanged native text and source-image provenance', () => {
    const f = fixture(), original = structuredClone(f), result = applySelectiveSourceRepair(f)
    expect(result.draft[0].extraction.passage).toBe('Correct sentence.')
    expect(result.draft[0].extraction.questions).toEqual(f.draft[0].extraction.questions)
    expect(result.ledger[0]).toMatchObject({ mode: 'patch', before: 'Original sentence.', after: 'Correct sentence.', imageHashes: { 9: 'original-image-hash' } })
    expect(f).toEqual(original)
  })
  it('rejects missing or stale candidate hashes', () => {
    const f = fixture(); delete f.repair.base_hash
    expect(compactSourceRepairSchema.safeParse(f.repair).success).toBe(false)
    expect(() => applySelectiveSourceRepair(f)).toThrow('patch hash')
    f.repair.base_hash = 'a'.repeat(64)
    expect(() => applySelectiveSourceRepair(f)).toThrow('patch hash')
  })
  it('resolves multiple spans against the original field, including length changes and deletion', () => {
    expect(applySourceTextPatches('alpha beta gamma', [
      { before: 'gamma', after: 'γ' }, { before: 'alpha ', after: '' }, { before: 'beta', after: 'much longer beta' },
    ])).toBe('much longer beta γ')
    // The second patch cannot match new text emitted by the first.
    expect(() => applySourceTextPatches('alpha', [{ before: 'alpha', after: 'beta' }, { before: 'beta', after: 'gamma' }])).toThrow('exactly once')
  })
  it('rejects missing, repeated, overlapping and no-op anchors instead of guessing', () => {
    for (const [text, patches] of [
      ['abc', [{ before: 'xyz', after: 'x' }]],
      ['abc abc', [{ before: 'abc', after: 'x' }]],
      ['aaaa', [{ before: 'aa', after: 'x' }]],
      ['abcde', [{ before: 'abc', after: 'x' }, { before: 'cde', after: 'y' }]],
      ['abc', [{ before: 'abc', after: 'abc' }]],
    ] as const) expect(() => applySourceTextPatches(text, [...patches])).toThrow()
  })
  it('permits an empty anchor only to fill an entirely empty field', () => {
    expect(applySourceTextPatches('', [{ before: '', after: '인쇄 해설' }])).toBe('인쇄 해설')
    expect(() => applySourceTextPatches('text', [{ before: '', after: 'prefix' }])).toThrow('empty field')
    expect(() => applySourceTextPatches('', [{ before: '', after: 'a' }, { before: '', after: 'b' }])).toThrow('empty field')
  })
  it('preserves Korean line breaks, English hyphens, paragraphs, footnotes and emphasis outside a patch', () => {
    const text = '한글 단어\n연결\n\n<strong><u>well-\nknown</u></strong> bad.\n* 각주'
    expect(applySourceTextPatches(text, [{ before: 'bad.', after: 'good.' }])).toBe(text.replace('bad.', 'good.'))
    const f = fixture('Original', '<strong><u>Correct</u></strong>')
    expect(applySelectiveSourceRepair(f).draft[0].extraction.passage).toBe('<strong><u>Correct</u></strong> sentence.')
  })
  it('rejects splitting a surrogate pair and unsafe HTML in the resulting field', () => {
    expect(() => applySourceTextPatches('😀 word', [{ before: '\uD83D', after: 'x' }])).toThrow('Unicode')
    expect(() => applySelectiveSourceRepair(fixture('Original', '<img src=x onerror=alert(1)>'))).toThrow('Unexpected markup')
  })
  it('rolls back all fields when any patch, target or image provenance is invalid', () => {
    const f = fixture(), original = structuredClone(f)
    const target = { g: 0, q: null, field: 'translation' as const, choice: null }
    f.audit.issues.push({ ...f.audit.issues[0], target })
    f.repair.edits.push({ target, mode: 'patch', patches: [{ before: 'not there', after: 'wrong' }], pages: [9] })
    expect(() => applySelectiveSourceRepair(f)).toThrow('exactly once')
    expect(f.draft).toEqual(original.draft)
    const unflagged = fixture(); unflagged.repair.edits[0].target = target
    expect(() => applySelectiveSourceRepair(unflagged)).toThrow('exactly the flagged')
    const wrongPage = fixture(); if (wrongPage.repair.edits[0].mode === 'patch') wrongPage.repair.edits[0].pages = [10]
    expect(() => applySelectiveSourceRepair(wrongPage)).toThrow('outside the audited')
  })
  it('forbids long-field rewrites in new replies but allows an explicit printed answer scalar', () => {
    const f = fixture()
    f.repair.edits = [{ target: f.target, mode: 'text', text: 'whole passage', pages: [9] }]
    expect(compactSourceRepairSchema.safeParse(f.repair).success).toBe(false)
    f.target = { g: 0, q: 0, field: 'answer', choice: null }; f.audit.issues[0].target = f.target
    f.repair.edits = [{ target: f.target, mode: 'text', text: '⑤', pages: [9] }]
    expect(compactSourceRepairSchema.safeParse(f.repair).success).toBe(true)
    expect(applySelectiveSourceRepair(f).draft[0].extraction.questions[0].answer).toBe(5)
  })
  it('bounds patch count and span size before applying provider output', () => {
    const f = fixture()
    if (f.repair.edits[0].mode !== 'patch') throw Error('fixture')
    f.repair.edits[0].patches[0].after = 'a'.repeat(4097)
    expect(compactSourceRepairSchema.safeParse(f.repair).success).toBe(false)
    f.repair.edits[0].patches = Array.from({ length: 31 }, () => ({ before: 'a', after: 'b' }))
    expect(compactSourceRepairSchema.safeParse(f.repair).success).toBe(false)
  })
})
