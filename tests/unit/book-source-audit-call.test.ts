import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/lib/llm/client', () => ({ MODELS: { parse: 'test-model' }, callLlmTextDetailed: mock.call,
  buildFileBlock: (data: string, mimeType: string) => ({ type: 'image', source: { data, media_type: mimeType } }), parseJsonObjectResponse: (text: string) => JSON.parse(text) }))
import { auditAndRepairSource } from '@/lib/book-pdf/audit-source'
import { sourceAuditFixture } from '../fixtures/book-source-audit'
import { sourceDraftHash } from '@/lib/book-pdf/source-audit-state'
const pass = { status: 'pass', checks: { content: true, mapping: true, formatting: true, inventory: true }, issues: [] }
const response = (v: unknown) => ({ text: JSON.stringify(v), stopReason: 'end_turn', usage: {} })
function input() { return { ...sourceAuditFixture(), images: [{ page: 9, data: 'original-image', sha256: 'original-image-hash' }] } }
beforeEach(() => { mock.call.mockReset() })
describe('image audit and bounded repair', () => {
  it('compares original images in a fresh request without PDF native text as the sole visual source', async () => {
    mock.call.mockResolvedValue(response(pass))
    const r = await auditAndRepairSource(input())
    expect(r.status).toBe('audited')
    const content = mock.call.mock.calls[0][0].content
    expect(content.some((b: { type: string }) => b.type === 'image')).toBe(true)
    expect(content.some((b: { type: string }) => b.type === 'document')).toBe(false)
    expect(content.some((b: object) => 'cache_control' in b)).toBe(false)
  })
  it('re-audits corrected fields in a separate call', async () => {
    const f = input()
    mock.call.mockResolvedValueOnce(response(f.audit)).mockResolvedValueOnce(response({ edits: [{ target: f.target, mode: 'text', text: 'Correct sentence.', pages: [9] }], issues: [] })).mockResolvedValueOnce(response(pass))
    const r = await auditAndRepairSource(f)
    expect(r.status).toBe('audited')
    expect(r.ledger).toHaveLength(1)
    expect(mock.call).toHaveBeenCalledTimes(3)
    const request = JSON.parse(mock.call.mock.calls[2][0].content.at(-1).text)
    expect(request.candidate[0].extraction.passage).toBe('Correct sentence.')
  })
  it('does not accept the repair output without fresh confirmation', async () => {
    const f = input()
    const repair = { edits: [{ target: f.target, mode: 'text', text: 'still wrong', pages: [9] }], issues: [] }
    mock.call.mockResolvedValueOnce(response(f.audit)).mockResolvedValueOnce(response(repair)).mockResolvedValueOnce(response(f.audit)).mockResolvedValueOnce(response(repair)).mockResolvedValueOnce(response(f.audit))
    const r = await auditAndRepairSource(f)
    expect(r.status).toBe('unresolved')
    expect(r.errors).toContain('repair_budget_exhausted')
    expect(mock.call).toHaveBeenCalledTimes(5)
  })
  it('can continue a recorded repair verdict once without paying to repeat that verdict', async () => {
    const f = input(), resume = { audit: f.audit, draftHash: sourceDraftHash(f.draft), repairsAlreadyUsed: 1 }
    mock.call.mockResolvedValueOnce(response({ edits: [{ target: f.target, mode: 'text', text: 'Correct sentence.', pages: [9] }], issues: [] })).mockResolvedValueOnce(response(pass))
    expect((await auditAndRepairSource({ ...f, resume })).status).toBe('audited')
    expect(mock.call).toHaveBeenCalledTimes(2)
    expect(JSON.parse(mock.call.mock.calls[0][0].content.at(-1).text).operation).toBe('source_repair')
  })
  it('rejects stale audit continuations before an API call', async () => {
    const f = input()
    await expect(auditAndRepairSource({ ...f, resume: { audit: f.audit, draftHash: 'stale', repairsAlreadyUsed: 1 } })).rejects.toThrow('stale')
    expect(mock.call).not.toHaveBeenCalled()
  })
  it('holds unreadable source and an invalid reviewer schema', async () => {
    mock.call.mockResolvedValueOnce(response({ ...pass, status: 'unreadable' })).mockResolvedValueOnce(response({ status: 'pass' }))
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
