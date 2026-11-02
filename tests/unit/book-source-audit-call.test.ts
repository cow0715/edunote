import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn(), cached: vi.fn() }))
vi.mock('@/lib/book-pdf/checkpoints', () => ({ readCachedBookCall: mock.cached }))
vi.mock('@/lib/llm/client', () => ({ MODELS: { parse: 'test-model' }, callLlmTextDetailed: mock.call,
  buildFileBlock: (data: string, mimeType: string) => ({ type: 'image', source: { data, media_type: mimeType } }), parseJsonObjectResponse: (text: string) => JSON.parse(text) }))
import { auditAndRepairSource, SOURCE_AUDIT_PROMPT, SOURCE_REPAIR_PROMPT, SOURCE_AUDIT_REPAIR_PROMPT } from '@/lib/book-pdf/audit-source'
import { sourceAuditFixture } from '../fixtures/book-source-audit'
import { sourceDraftHash } from '@/lib/book-pdf/source-audit-state'
import { PdfBatchPending } from '@/lib/pdf-import/batch-policy'
import { withPdfWorkerContext } from '@/lib/pdf-import/context'
import { writeBookUnitStage } from '@/lib/book-pdf/unit-progress'
import { bookFingerprint } from '@/lib/book-pdf/proof'
import { SourceOutputIncompleteError } from '@/lib/book-pdf/source-output-policy'
import { LEGACY_IMAGE_AUDIT_POLICY, SOURCE_IMAGE_AUDIT_PROMPT, SOURCE_IMAGE_AUDIT_POLICY } from '@/lib/book-pdf/image-audit-input'
const pass = { status: 'pass', checks: { content: true, mapping: true, formatting: true, inventory: true }, issues: [] }
const compactPass = { ...pass, repair: null }
const findingsPass = { reviewed: pass.checks, findings: [] }
const response = (v: unknown) => ({ text: JSON.stringify(v), stopReason: 'end_turn', usage: {} })
function input() { return { ...sourceAuditFixture(), images: [{ page: 9, data: 'original-image', sha256: 'original-image-hash' }] } }
beforeEach(() => { mock.call.mockReset(); mock.cached.mockReset().mockResolvedValue(null) })
function proposed(f: ReturnType<typeof input>, before = 'Original', after = 'Correct') {
  return { ...f.audit, repair: { base_hash: sourceDraftHash(f.draft), edits: [{ target: f.target, mode: 'patch', patches: [{ before, after }], pages: [9] }], issues: [] } }
}
describe('image audit and bounded repair', () => {
  it('reuses an exact v1 independent image pass without a paid request', async () => {
    mock.cached.mockImplementation(async (options) => options.some((o: { bookOperation?: { evidence?: { imageInputPolicy?: string } } }) =>
      o.bookOperation?.evidence?.imageInputPolicy === LEGACY_IMAGE_AUDIT_POLICY) ? response(pass) : null)
    expect((await auditAndRepairSource({ ...input(), failureMode: 'hold' })).status).toBe('audited')
    expect(mock.call).not.toHaveBeenCalled()
  })
  it('holds contradictory observations and reuses that hold on restart without buying another audit', async () => {
    const f = input(), saved = new Map<string, unknown>(), checkpoint = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }
    const context = { signal: new AbortController().signal, concurrency: 1, execute: async <T,>(fn: () => Promise<T>) => fn(), stage: async () => {},
      read: async <T,>(key: string) => (saved.get(key) ?? null) as T | null, write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) } }
    const raw = { reviewed: pass.checks, findings: f.audit.issues.map(i => ({ ...i, result: 'mismatch', original: 'same', candidate: 'same' })) }
    mock.call.mockResolvedValueOnce(response(raw))
    const run = () => withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint, failureMode: 'hold' }))
    expect((await run()).status).toBe('unresolved')
    // A malformed paid response can be replayed from its immutable checkpoint,
    // but cannot cause an implicit new request when that checkpoint is missing.
    await expect(run()).rejects.toThrow('유료 재요청을 차단')
    expect(mock.call).toHaveBeenCalledOnce()
  })
  it('independently audits original images without leaking corrupt native text into the verdict input', async () => {
    const f = input()
    f.pages[0].lines[0].text = 'CORRUPT_NATIVE_PUNCTUATION_SENTINEL'
    f.draft[0].extraction.translation = '(A) 원본 A 해석\n(D) 원본 D 해석\n(C) 원본 C 해석\n(B) 원본 B 해석'
    mock.call.mockResolvedValueOnce(response(findingsPass))
    const result = await auditAndRepairSource({ ...f, failureMode: 'hold' })
    expect(result.status).toBe('audited')
    const options = mock.call.mock.calls[0][0]
    expect(JSON.stringify(options)).not.toContain('CORRUPT_NATIVE_PUNCTUATION_SENTINEL')
    expect(options.content.filter((c: { type: string }) => c.type === 'image')).toEqual([
      { type: 'image', source: { data: 'original-image', media_type: 'image/png' } },
    ])
    const request = JSON.parse(options.content.at(-1).text)
    expect(request).not.toHaveProperty('source')
    expect(request).not.toHaveProperty('mapping')
    expect(request.candidate[0].extraction.translation).toBe(f.draft[0].extraction.translation)
    expect(request.pages).toEqual([9])
    expect(options.bookOperation.evidence.imageInputPolicy).toBe(SOURCE_IMAGE_AUDIT_POLICY)
    expect(result.groups[0].extraction.translation).toBe(f.draft[0].extraction.translation)
  })
  it('keeps mismatches held with no generated repair in the independent image comparison', async () => {
    const f = input()
    mock.call.mockResolvedValueOnce(response({ reviewed: pass.checks, findings: f.audit.issues.map(i => ({ ...i, result: 'mismatch', original: 'Correct', candidate: 'Original' })) }))
    const result = await auditAndRepairSource({ ...f, failureMode: 'hold' })
    expect(result.status).toBe('unresolved')
    expect(result.groups).toEqual(f.draft)
    expect(result.ledger).toHaveLength(0)
    expect(mock.call).toHaveBeenCalledOnce()
    expect(result.errors.some(e => e.includes(f.audit.issues[0].reason))).toBe(true)
  })
  it('holds the first mismatch, retains its paid patch, and requires a manual action plus fresh image pass', async () => {
    const f = input(), saved = new Map<string, unknown>(), checkpoint = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }
    const context = { signal: new AbortController().signal, concurrency: 1, execute: async <T,>(fn: () => Promise<T>) => fn(), stage: async () => {},
      read: async <T,>(key: string) => (saved.get(key) ?? null) as T | null, write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) } }
    const run = () => auditAndRepairSource({ ...f, checkpoint, failureMode: 'hold' as const })
    mock.cached.mockResolvedValueOnce(null).mockResolvedValueOnce(response(proposed(f)))
    const held = await withPdfWorkerContext(context, run)
    expect(held.status).toBe('unresolved'); expect(held.groups).toEqual(f.draft); expect(held.ledger).toHaveLength(0)
    expect(held.errors.some(e => e.includes(f.audit.issues[0].reason))).toBe(true)
    await withPdfWorkerContext(context, run)
    expect(mock.call).not.toHaveBeenCalled()
    mock.call.mockResolvedValueOnce(response(findingsPass))
    const complete = await withPdfWorkerContext({ ...context, bookResume: { id: '11111111-1111-4111-8111-111111111111', stage: 'audit' } }, run)
    expect(complete.status).toBe('audited'); expect(complete.groups[0].extraction.passage).toBe('Correct sentence.')
    expect(complete.ledger).toHaveLength(1); expect(mock.call).toHaveBeenCalledOnce()
    expect(mock.call.mock.calls[0][0].content.some((c: { type: string }) => c.type === 'image')).toBe(true)
    expect(mock.call.mock.calls[0][0].content.at(-2).text).toBe(SOURCE_IMAGE_AUDIT_PROMPT)
    expect(JSON.parse(mock.call.mock.calls[0][0].content.at(-1).text).candidate[0].extraction.passage).toBe('Correct sentence.')
  })
  it('requires an independent completed image comparison after a correction when output is truncated', async () => {
    const f = input(), saved = new Map<string, unknown>(), checkpoint = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }
    const context = { signal: new AbortController().signal, concurrency: 1, execute: async <T,>(fn: () => Promise<T>) => fn(), stage: async () => {},
      read: async <T,>(key: string) => (saved.get(key) ?? null) as T | null, write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) } }
    const run = () => withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint }))
    mock.call.mockResolvedValueOnce(response(proposed(f))).mockResolvedValueOnce({ ...response(compactPass), stopReason: 'max_tokens' })
    await expect(run()).rejects.toBeInstanceOf(SourceOutputIncompleteError)
    mock.call.mockResolvedValueOnce(response(compactPass))
    const result = await run()
    expect(result.status).toBe('audited'); expect(result.ledger).toHaveLength(1); expect(result.audits).toHaveLength(2)
    expect(JSON.parse(mock.call.mock.calls[2][0].content.at(-1).text).round).toBe(2)
    expect(JSON.parse(mock.call.mock.calls[2][0].content.at(-1).text).candidate[0].extraction.passage).toBe('Correct sentence.')
  })
  it('replays a previously held format-only verdict from the paid reply without a new API call', async () => {
    const f = input(), scope = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }, saved = new Map<string, unknown>()
    const context = { signal: new AbortController().signal, concurrency: 1, execute: async <T,>(fn: () => Promise<T>) => fn(), stage: async () => {},
      read: async <T,>(key: string) => (saved.get(key) ?? null) as T | null, write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) } }
    await withPdfWorkerContext(context, async () => {
      await writeBookUnitStage(scope, 'audit', { binding: bookFingerprint({ pages: f.pages, images: f.images.map(i => [i.page,i.sha256]), mapping: f.mapping, draft: f.draft }),
        mapping: f.mapping, draft: f.draft, audits: [pass], ledger: [], repairs: 0, pending: null, finished: 'unresolved', errors: ['invalid_combined_repair_contract'] })
      mock.cached.mockResolvedValueOnce(null).mockResolvedValueOnce(response(pass))
      const r = await auditAndRepairSource({ ...f, checkpoint: scope })
      expect(r.status).toBe('audited'); expect(r.audits).toHaveLength(1); expect(r.ledger).toHaveLength(0)
    })
    expect(mock.call).not.toHaveBeenCalled()
  })
  it('locally accepts the redundant refs pages, but still requires a fresh full image pass after applying', async () => {
    const f = input(), reply = { ...f.audit, repair: { base_hash: sourceDraftHash(f.draft), edits: [{ target: f.target, mode: 'refs', refs: [{ s: 1 }], pages: [9] }], issues: [] } }
    mock.call.mockResolvedValueOnce(response(reply)).mockResolvedValueOnce(response(pass))
    const r = await auditAndRepairSource(f)
    expect(r.status).toBe('audited'); expect(r.audits).toHaveLength(2); expect(r.ledger).toHaveLength(1)
    expect(mock.call).toHaveBeenCalledTimes(2)
  })
  it('keeps a lost format-error reply fenced across repeated restarts instead of buying it again', async () => {
    const f = input(), scope = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }, saved = new Map<string, unknown>()
    const context = { signal: new AbortController().signal, concurrency: 1, execute: async <T,>(fn: () => Promise<T>) => fn(), stage: async () => {},
      read: async <T,>(key: string) => (saved.get(key) ?? null) as T | null, write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) } }
    await withPdfWorkerContext(context, async () => {
      await writeBookUnitStage(scope, 'audit', { binding: bookFingerprint({ pages: f.pages, images: f.images.map(i => [i.page,i.sha256]), mapping: f.mapping, draft: f.draft }),
        mapping: f.mapping, draft: f.draft, audits: [pass], ledger: [], repairs: 0, pending: null, finished: 'unresolved', errors: ['invalid_combined_repair_contract'] })
      for (let n = 0; n < 2; n++) await expect(auditAndRepairSource({ ...f, checkpoint: scope })).rejects.toThrow('유료 재요청을 차단')
    })
    expect(mock.call).not.toHaveBeenCalled()
  })
  it('keeps the two-repair ceiling through repeated waits and permanently reuses the final hold', async () => {
    const f = input(), saved = new Map<string, unknown>(), checkpoint = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }
    const context = { signal: new AbortController().signal, concurrency: 1, execute: async <T,>(fn: () => Promise<T>) => fn(), stage: async () => {},
      read: async <T,>(key: string) => saved.get(key) as T ?? null, write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) } }
    const next = structuredClone(f); next.draft[0].extraction.passage = 'Still wrong sentence.'
    const run = () => withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint }))
    mock.call.mockResolvedValueOnce(response(proposed(f, 'Original', 'Still wrong'))).mockRejectedValueOnce(new PdfBatchPending())
    await expect(run()).rejects.toBeInstanceOf(PdfBatchPending)
    mock.call.mockResolvedValueOnce(response(proposed(next, 'Still wrong', 'Again wrong'))).mockRejectedValueOnce(new PdfBatchPending())
    await expect(run()).rejects.toBeInstanceOf(PdfBatchPending)
    mock.call.mockResolvedValueOnce(response(f.audit))
    const result = await run()
    expect(result.status).toBe('unresolved'); expect(result.errors).toContain('repair_budget_exhausted')
    expect(result.audits).toHaveLength(3); expect(result.ledger).toHaveLength(2)
    await run(); expect(mock.call).toHaveBeenCalledTimes(5)
    await expect(withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint,
      images: [{ ...f.images[0], sha256: 'changed-image' }] }))).rejects.toThrow('evidence changed')
    expect(mock.call).toHaveBeenCalledTimes(5)
  })
  it('continues a saved corrected candidate without replaying its verdict or repair request', async () => {
    const f = input(), saved = new Map<string, unknown>(), checkpoint = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }
    const context = { signal: new AbortController().signal, concurrency: 1, execute: async <T,>(fn: () => Promise<T>) => fn(), stage: async () => {},
      read: async <T,>(key: string) => saved.get(key) as T ?? null,
      write: async (key: string, value: unknown) => { saved.set(key, JSON.parse(JSON.stringify(value))) } }
    mock.call.mockResolvedValueOnce(response(proposed(f))).mockRejectedValueOnce(new PdfBatchPending())
    await expect(withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint }))).rejects.toBeInstanceOf(PdfBatchPending)
    mock.call.mockResolvedValueOnce(response(compactPass))
    const result = await withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint }))
    expect(result.status).toBe('audited'); expect(result.audits).toHaveLength(2); expect(result.ledger).toHaveLength(1)
    expect(JSON.parse(mock.call.mock.calls[2][0].content.at(-1).text).candidate[0].extraction.passage).toBe('Correct sentence.')
    await withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint }))
    expect(mock.call).toHaveBeenCalledTimes(3)
  })
  it('saves a legacy repair verdict before waiting for its separate correction response', async () => {
    const f = input(), saved = new Map<string, unknown>(), checkpoint = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }
    const context = { signal: new AbortController().signal, concurrency: 1, execute: async <T,>(fn: () => Promise<T>) => fn(), stage: async () => {},
      read: async <T,>(key: string) => saved.get(key) as T ?? null, write: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)) } }
    mock.cached.mockResolvedValueOnce(response(f.audit)); mock.call.mockRejectedValueOnce(new PdfBatchPending())
    await expect(withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint }))).rejects.toBeInstanceOf(PdfBatchPending)
    mock.call.mockResolvedValueOnce(response(proposed(f).repair)).mockResolvedValueOnce(response(compactPass))
    expect((await withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, checkpoint }))).status).toBe('audited')
    const operations = mock.call.mock.calls.map(([o]) => JSON.parse(o.content.at(-1).text).operation)
    expect(operations).toEqual(['source_repair', 'source_repair', 'source_audit'])
  })
  it('reuses a legacy repair with notes only after an independent full-image pass', async () => {
    const f = input(), notes = ['The source arrow was represented as ↓.']
    mock.cached.mockResolvedValueOnce(response(f.audit))
      .mockResolvedValueOnce(response({ edits: [{ target: f.target, mode: 'text', text: 'Correct sentence.', pages: [9] }], issues: notes }))
      .mockResolvedValueOnce(response(pass))
    const result = await auditAndRepairSource(f)
    expect(result.status).toBe('audited'); expect(result.ledger[0].repair_notes).toEqual(notes)
    const final = mock.cached.mock.calls[2][0][0].content.at(-1).text
    expect(JSON.parse(final)).toMatchObject({ round: 2, candidate: [{ extraction: { passage: 'Correct sentence.' } }] })
    expect(mock.call).not.toHaveBeenCalled()
  })
  it.each(['missing', 'unreadable'])('keeps a noted repair unapproved when its final image audit is %s', async (kind) => {
    const f = input(), original = structuredClone(f.draft)
    mock.cached.mockResolvedValueOnce(response(f.audit))
      .mockResolvedValueOnce(response({ edits: [{ target: f.target, mode: 'text', text: 'Correct sentence.', pages: [9] }], issues: ['Some source detail is uncertain.'] }))
    if (kind === 'missing') {
      mock.call.mockRejectedValueOnce(new PdfBatchPending())
      await expect(auditAndRepairSource(f)).rejects.toBeInstanceOf(PdfBatchPending)
    } else {
      mock.call.mockResolvedValueOnce(response({ ...compactPass, status: 'unreadable' }))
      const result = await auditAndRepairSource(f)
      expect(result.status).toBe('unresolved'); expect(result.errors).toContain('audit_not_actionable')
      expect(result.ledger[0].repair_notes).toEqual(['Some source detail is uncertain.'])
    }
    expect(f.draft).toEqual(original)
    expect(mock.call).toHaveBeenCalledOnce()
  })
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
