import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { auditAndRepairSource, SOURCE_AUDIT_PROMPT, SOURCE_REPAIR_PROMPT } from '@/lib/book-pdf/audit-source'
import { buildFileBlock, createLlmExecution, llmCallKey } from '@/lib/llm/client'
import type { CallLlmOptions, LlmDetailedResult } from '@/lib/llm/types'
import { withPdfWorkerContext, type PdfWorkerContext } from '@/lib/pdf-import/context'
import { PdfBatchPending } from '@/lib/pdf-import/batch-policy'
import { sourceAuditEvidence, sourceDraftHash } from '@/lib/book-pdf/source-audit-state'
import { sourceMapEvidence } from '@/lib/book-pdf/source-map'
import { sourceAuditFixture } from '../fixtures/book-source-audit'

const pass = { status: 'pass', checks: { content: true, mapping: true, formatting: true, inventory: true }, issues: [] }
function fixture() {
  const f = sourceAuditFixture(), images = [{ page: 9, data: 'original-image', sha256: 'original-image-hash' }]
  const saved = new Map<string, unknown>(), execution = createLlmExecution()
  const batchCall = vi.fn<(options: CallLlmOptions, key: string) => Promise<LlmDetailedResult>>(async () => { throw new PdfBatchPending() })
  const context: PdfWorkerContext = { cacheOnly: true, signal: new AbortController().signal, concurrency: 1, execute: (fn) => fn(), stage: async () => {},
    read: async <T>(key: string) => (saved.get(key) ?? null) as T | null,
    write: async (key, value) => { saved.set(key, value) }, batchCall }
  function result(value: unknown): LlmDetailedResult {
    return { text: JSON.stringify(value), stopReason: 'end_turn', finishReason: 'complete', usage: {},
      execution: { task: 'book.auditSource', requestedModel: execution.taskBindings['book.auditSource'], configVersion: execution.configVersion } } as LlmDetailedResult
  }
  function oldOptions(prompt: string, request: object, maxTokens: number): CallLlmOptions {
    return { task: 'book.auditSource', stream: true, maxTokens, content: [
      { type: 'text', text: '원본 9쪽 이미지' }, buildFileBlock(images[0].data, 'image/png'),
      { type: 'text', text: prompt }, { type: 'text', text: JSON.stringify(request) },
    ] }
  }
  return { f, images, saved, execution, batchCall, context, result, oldOptions, run: () => withPdfWorkerContext(context, () => auditAndRepairSource({ ...f, images })) }
}

describe('book audit restart with real request identities and no provider network', () => {
  it('keeps the deployed pre-compact prompt bytes stable so existing paid request keys remain readable', () => {
    expect(createHash('sha256').update(SOURCE_AUDIT_PROMPT).digest('hex')).toBe('249ef5e2d069d85218ebc3127296ce359b512a6552dc29f540d512d533758ea2')
    expect(createHash('sha256').update(SOURCE_REPAIR_PROMPT).digest('hex')).toBe('1a28be9f269ebc2c0bf8ba632c16783b4bb301aec1d1c40ffe0443f8a56f8301')
  })
  it('consumes legacy Batch audit/whole-field repair/final confirmation with zero new requests', async () => {
    const s = fixture(), { f } = s
    const common = { source: sourceMapEvidence(f.pages), mapping: f.mapping, candidate: sourceAuditEvidence(f.draft) }
    const audit = s.oldOptions(SOURCE_AUDIT_PROMPT, { operation: 'source_audit', round: 1, ...common }, 4000)
    const repair = s.oldOptions(SOURCE_REPAIR_PROMPT, { operation: 'source_repair', ...common, issues: f.audit.issues }, 10000)
    const fixed = structuredClone(f.draft); fixed[0].extraction.passage = 'Correct sentence.'
    const final = s.oldOptions(SOURCE_AUDIT_PROMPT, { operation: 'source_audit', round: 2, ...common, candidate: sourceAuditEvidence(fixed) }, 4000)
    for (const [options, value] of [
      [audit, f.audit], [repair, { edits: [{ target: f.target, mode: 'text', text: 'Correct sentence.', pages: [9] }], issues: [] }], [final, pass],
    ] as const) s.saved.set(`batch-result:${llmCallKey(options, s.execution)}`, { result: s.result(value) })
    const result = await s.run()
    expect(result.status).toBe('audited'); expect(result.groups).toEqual(fixed)
    expect(s.batchCall).not.toHaveBeenCalled()
  })
  it('replays the combined response after a worker exit and requests only the missing final audit', async () => {
    const s = fixture(), before = structuredClone(s.f.draft)
    const combined = { ...s.f.audit, repair: { base_hash: sourceDraftHash(s.f.draft), edits: [
      { target: s.f.target, mode: 'patch', patches: [{ before: 'Original', after: 'Correct' }], pages: [9] },
    ], issues: [] } }
    // The fake transport only delivers stored values and suspends on missing ones.
    s.batchCall.mockImplementation(async (options, key) => {
      const delivery = s.saved.get(`batch-result:${key}`) as { result: LlmDetailedResult } | undefined
      if (delivery) return delivery.result
      if (!JSON.parse((options.content as { text?: string }[]).at(-1)!.text!).round) throw Error('request')
      throw new PdfBatchPending()
    })
    await expect(s.run()).rejects.toBeInstanceOf(PdfBatchPending)
    const firstKey = s.batchCall.mock.calls[0][1]
    s.saved.set(`batch-result:${firstKey}`, { result: s.result(combined) })
    s.batchCall.mockClear()
    await expect(s.run()).rejects.toBeInstanceOf(PdfBatchPending)
    expect(s.batchCall).toHaveBeenCalledTimes(2) // consume delivery, then suspend on final
    const finalOptions = s.batchCall.mock.calls[1][0], finalKey = s.batchCall.mock.calls[1][1]
    expect(finalKey).not.toBe(firstKey)
    expect(JSON.parse((finalOptions.content as { text?: string }[]).at(-1)!.text!).candidate[0].extraction.passage).toBe('Correct sentence.')
    s.saved.set(`batch-result:${finalKey}`, { result: s.result({ ...pass, repair: null }) })
    s.batchCall.mockClear()
    expect((await s.run()).status).toBe('audited')
    expect(s.batchCall).toHaveBeenCalledOnce() // final delivery; first response is already checkpointed
    s.batchCall.mockClear()
    expect((await s.run()).status).toBe('audited')
    expect(s.batchCall).not.toHaveBeenCalled()
    expect(s.f.draft).toEqual(before)
  })
})
