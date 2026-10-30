import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn(), cached: vi.fn() }))
vi.mock('@/lib/book-pdf/checkpoints', () => ({ readCachedBookCall: mock.cached }))
vi.mock('@/lib/llm/client', () => ({ MODELS: { parse: 'test-model' }, callLlmTextDetailed: mock.call,
  buildFileBlock: (data: string, mimeType: string) => ({ type: 'image', source: { data, media_type: mimeType } }), parseJsonObjectResponse: (text: string) => JSON.parse(text) }))
import { auditAndRepairSource, SOURCE_AUDIT_PROMPT, SOURCE_REPAIR_PROMPT, SOURCE_AUDIT_REPAIR_PROMPT } from '@/lib/book-pdf/audit-source'
import { sourceAuditFixture } from '../fixtures/book-source-audit'
import { sourceDraftHash } from '@/lib/book-pdf/source-audit-state'
const pass = { status: 'pass', checks: { content: true, mapping: true, formatting: true, inventory: true }, issues: [] }
const compactPass = { ...pass, repair: null }
const response = (v: unknown) => ({ text: JSON.stringify(v), stopReason: 'end_turn', usage: {} })
function input() { return { ...sourceAuditFixture(), images: [{ page: 9, data: 'original-image', sha256: 'original-image-hash' }] } }
beforeEach(() => { mock.call.mockReset(); mock.cached.mockReset().mockResolvedValue(null) })
function proposed(f: ReturnType<typeof input>, before = 'Original', after = 'Correct') {
  return { ...f.audit, repair: { base_hash: sourceDraftHash(f.draft), edits: [{ target: f.target, mode: 'patch', patches: [{ before, after }], pages: [9] }], issues: [] } }
}
describe('image audit and bounded repair', () => {
  it('compares original images in a fresh request without PDF native text as the sole visual source', async () => {
    mock.call.mockResolvedValue(response(compactPass))
    const r = await auditAndRepairSource(input())
    expect(r.status).toBe('audited')
    const content = mock.call.mock.calls[0][0].content
    expect(content.some((b: { type: string }) => b.type === 'image')).toBe(true)
    expect(content.some((b: { type: string }) => b.type === 'document')).toBe(false)
    expect(content.some((b: object) => 'cache_control' in b)).toBe(false)
  })
  it('combines diagnosis and short patch output, then independently re-audits the entire candidate', async () => {
    const f = input()
    mock.call.mockResolvedValueOnce(response(proposed(f))).mockResolvedValueOnce(response(compactPass))
    const r = await auditAndRepairSource(f)
    expect(r.status).toBe('audited')
    expect(r.ledger).toHaveLength(1)
    expect(mock.call).toHaveBeenCalledTimes(2)
    const request = JSON.parse(mock.call.mock.calls[1][0].content.at(-1).text)
    expect(request.candidate[0].extraction.passage).toBe('Correct sentence.')
    expect(request.candidate_hash).toBe(r.draftHash)
    expect(mock.call.mock.calls.every(([o]) => o.content.some((b: { type: string }) => b.type === 'image'))).toBe(true)
    expect(mock.call.mock.calls.every(([o]) => JSON.parse(o.content.at(-1).text).operation === 'source_audit')).toBe(true)
  })
  it('does not accept the repair output without fresh confirmation', async () => {
    const f = input()
    const next = structuredClone(f); next.draft[0].extraction.passage = 'Still wrong sentence.'
    mock.call.mockResolvedValueOnce(response(proposed(f, 'Original', 'Still wrong')))
      .mockResolvedValueOnce(response(proposed(next, 'Still wrong', 'Again wrong'))).mockResolvedValueOnce(response(f.audit))
    const r = await auditAndRepairSource(f)
    expect(r.status).toBe('unresolved')
    expect(r.errors).toContain('repair_budget_exhausted')
    expect(mock.call).toHaveBeenCalledTimes(3)
    expect(mock.call.mock.calls[2][0].content.at(-2).text).toBe(SOURCE_AUDIT_PROMPT)
  })
  it('can continue a recorded repair verdict once without paying to repeat that verdict', async () => {
    const f = input(), resume = { audit: f.audit, draftHash: sourceDraftHash(f.draft), repairsAlreadyUsed: 1 }
    mock.call.mockResolvedValueOnce(response(proposed(f).repair)).mockResolvedValueOnce(response(pass))
    expect((await auditAndRepairSource({ ...f, resume })).status).toBe('audited')
    expect(mock.call).toHaveBeenCalledTimes(2)
    expect(JSON.parse(mock.call.mock.calls[0][0].content.at(-1).text).operation).toBe('source_repair')
  })
  it('replays a paid legacy audit, whole-field repair and final pass without generating any new response', async () => {
    const f = input()
    mock.cached.mockResolvedValueOnce(response(f.audit))
      .mockResolvedValueOnce(response({ edits: [{ target: f.target, mode: 'text', text: 'Correct sentence.', pages: [9] }], issues: [] }))
      .mockResolvedValueOnce(response(pass))
    const result = await auditAndRepairSource(f)
    expect(result.status).toBe('audited'); expect(result.groups[0].extraction.passage).toBe('Correct sentence.')
    expect(mock.call).not.toHaveBeenCalled()
    expect(mock.cached.mock.calls[0][0][0]).toMatchObject({ maxTokens: 4000 })
    expect(mock.cached.mock.calls[0][0][0].content.at(-2).text).toBe(SOURCE_AUDIT_PROMPT)
    expect(mock.cached.mock.calls[1][0][0]).toMatchObject({ maxTokens: 10000 })
    expect(mock.cached.mock.calls[1][0][0].content.at(-2).text).toBe(SOURCE_REPAIR_PROMPT)
    expect(JSON.parse(mock.cached.mock.calls[0][0][0].content.at(-1).text)).not.toHaveProperty('candidate_hash')
  })
  it.each(['missing', 'wrong-hash', 'whole-field', 'pass-with-edit', 'invalid-anchor'])('holds a %s combined response without paying for an automatic repair fallback', async (kind) => {
    const f = input(), reply = proposed(f)
    const value: Record<string, unknown> = reply
    if (kind === 'missing') delete value.repair
    if (kind === 'wrong-hash') reply.repair.base_hash = '0'.repeat(64)
    if (kind === 'whole-field') value.repair = { ...reply.repair, edits: [{ target: f.target, mode: 'text', text: 'Correct sentence.', pages: [9] }] }
    if (kind === 'pass-with-edit') Object.assign(value, pass)
    if (kind === 'invalid-anchor') reply.repair.edits[0].patches[0].before = 'not in source'
    mock.call.mockResolvedValueOnce(response(value))
    const result = await auditAndRepairSource(f)
    expect(result.status).toBe('unresolved'); expect(result.ledger).toHaveLength(0)
    expect(result.groups).toEqual(f.draft); expect(mock.call).toHaveBeenCalledOnce()
  })
  it('does not promote a patch to pass if the following audit is incomplete or malformed', async () => {
    const f = input(); mock.call.mockResolvedValueOnce(response(proposed(f))).mockResolvedValueOnce(response({ status: 'pass' }))
    const result = await auditAndRepairSource(f)
    expect(result.status).toBe('unresolved'); expect(result.errors).toContain('invalid_audit_schema')
    expect(result.ledger).toHaveLength(1)
  })
  it('uses the new compact prompt only for uncached work', async () => {
    mock.call.mockResolvedValueOnce(response(compactPass))
    await auditAndRepairSource(input())
    expect(mock.call.mock.calls[0][0].content.at(-2).text).toBe(SOURCE_AUDIT_REPAIR_PROMPT)
  })
  it('rejects stale audit continuations before an API call', async () => {
    const f = input()
    await expect(auditAndRepairSource({ ...f, resume: { audit: f.audit, draftHash: 'stale', repairsAlreadyUsed: 1 } })).rejects.toThrow('stale')
    expect(mock.call).not.toHaveBeenCalled()
  })
  it('holds unreadable source and an invalid reviewer schema', async () => {
    mock.call.mockResolvedValueOnce(response({ ...compactPass, status: 'unreadable' })).mockResolvedValueOnce(response({ status: 'pass' }))
    expect((await auditAndRepairSource(input())).status).toBe('unresolved')
    expect((await auditAndRepairSource(input())).errors).toContain('invalid_audit_schema')
    expect(mock.call).toHaveBeenCalledTimes(2)
  })
  it('requires original images for every provided page', async () => {
    const f = input(); f.images = []
    await expect(auditAndRepairSource(f)).rejects.toThrow('original images')
    expect(mock.call).not.toHaveBeenCalled()
  })
})
