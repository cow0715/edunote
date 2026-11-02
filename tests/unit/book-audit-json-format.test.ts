import { describe, expect, it } from 'vitest'
import { applySelectiveSourceRepair, normalizeSourceAuditEnvelope, parseSourceRepairResponse, sourceAuditErrors, sourceDraftHash } from '@/lib/book-pdf/source-audit-state'
import { sourceAuditFixture } from '../fixtures/book-source-audit'

describe('bounded audit JSON compatibility', () => {
  it('fills only an omitted no-edit null and never discards an explicit repair object', () => {
    const pass = { status: 'pass', checks: { content: true, mapping: true, formatting: true, inventory: true }, issues: [] }
    expect(normalizeSourceAuditEnvelope(pass)).toEqual({ ...pass, repair: null })
    expect(pass).not.toHaveProperty('repair')
    const hidden = { ...pass, repair: { edits: [] } }
    expect(normalizeSourceAuditEnvelope(hidden)).toBe(hidden)
    expect(normalizeSourceAuditEnvelope({ ...pass, status: 'repair' })).not.toHaveProperty('repair')
    expect(sourceAuditErrors({ ...pass, status: 'pass', checks: { ...pass.checks, content: false } } as never, sourceAuditFixture().draft, sourceAuditFixture().pages)).toContain('inconsistent_audit_pass')
  })
  it('accepts redundant in-window refs pages without changing targets or native ownership checks', () => {
    const f = sourceAuditFixture()
    const reply = { base_hash: sourceDraftHash(f.draft), edits: [{ target: f.target, mode: 'refs', refs: [{ s: 1 }], pages: [9] }], issues: [] }
    const parsed = parseSourceRepairResponse(reply, true, [9])
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw Error('valid repair rejected')
    expect(parsed.data.edits[0]).not.toHaveProperty('pages')
    expect(reply.edits[0].pages).toEqual([9])
    expect(applySelectiveSourceRepair({ ...f, expectedHash: sourceDraftHash(f.draft), repair: parsed.data }).draft).toEqual(f.draft)
  })
  it.each([{ pages: [99] }, { pages: [] }, { pages: [9, 9] }, { pages: ['9'] }, { pages: [-1] }])('rejects contradictory or malformed decorative pages $pages', ({ pages }) => {
    const f = sourceAuditFixture()
    expect(parseSourceRepairResponse({ base_hash: sourceDraftHash(f.draft), edits: [{ target: f.target, mode: 'refs', refs: [{ s: 1 }], pages }], issues: [] }, true, [9]).success).toBe(false)
  })
  it('still rejects unknown edit fields, stale hashes and out-of-window references', () => {
    const f = sourceAuditFixture()
    const reply = { base_hash: '0'.repeat(64), edits: [{ target: f.target, mode: 'refs', refs: [{ s: 999 }], pages: [9] }], issues: [] }
    expect(parseSourceRepairResponse({ ...reply, edits: [{ ...reply.edits[0], injected: true }] }, true, [9]).success).toBe(false)
    const parsed = parseSourceRepairResponse(reply, true, [9])
    if (!parsed.success) throw Error('expected shape-compatible repair')
    expect(() => applySelectiveSourceRepair({ ...f, expectedHash: sourceDraftHash(f.draft), repair: parsed.data })).toThrow('Stale')
    parsed.data.base_hash = sourceDraftHash(f.draft)
    expect(() => applySelectiveSourceRepair({ ...f, expectedHash: sourceDraftHash(f.draft), repair: parsed.data })).toThrow('native ownership')
  })
})
