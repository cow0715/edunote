import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { auditAndRepairSource, SOURCE_AUDIT_PROMPT, SOURCE_REPAIR_PROMPT, SOURCE_AUDIT_REPAIR_PROMPT, LEGACY_COMPACT_SOURCE_AUDIT_REPAIR_PROMPT } from '@/lib/book-pdf/audit-source'
import { buildFileBlock, createLlmExecution, llmCallKey } from '@/lib/llm/client'
import type { CallLlmOptions, LlmDetailedResult } from '@/lib/llm/types'
import { withPdfWorkerContext, type PdfWorkerContext } from '@/lib/pdf-import/context'
import { PdfBatchPending } from '@/lib/pdf-import/batch-policy'
import { sourceAuditEvidence, sourceDraftHash } from '@/lib/book-pdf/source-audit-state'
import { sourceMapEvidence } from '@/lib/book-pdf/source-map'
import { sourceAuditFixture } from '../fixtures/book-source-audit'
import { SOURCE_OUTPUT_POLICY, SourceOutputIncompleteError } from '@/lib/book-pdf/source-output-policy'
import { buildAnthropicRequest } from '@/lib/llm/providers/anthropic'
import { getModel, MODEL_IDS } from '@/lib/llm/models'
import { bookRequestIdentity } from '@/lib/book-pdf/request-identity'
import { BOOK_FAILURE_POLICY } from '@/lib/book-pdf/failure-policy'

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
  it('reuses a paid pre-independent hold-policy pass with zero new requests', async () => {
    const s = fixture()
    const evidence = { operation: 'source_audit', source: sourceMapEvidence(s.f.pages), mapping: s.f.mapping, candidate: sourceAuditEvidence(s.f.draft) }
    const old: CallLlmOptions = { ...s.oldOptions(SOURCE_AUDIT_PROMPT, { operation: evidence.operation, round: 1, source: evidence.source, mapping: evidence.mapping, candidate: evidence.candidate }, 6000),
      reasoning: { type: 'between_tools', effort: 'high' },
      bookOperation: { kind: 'audit', evidence: { images: [[9, s.images[0].sha256]], request: evidence, outputPolicy: SOURCE_OUTPUT_POLICY, failurePolicy: BOOK_FAILURE_POLICY } } }
    const key = llmCallKey(old, s.execution), delivery = { result: s.result(pass) }
    s.saved.set(`batch-result:${key}`, delivery)
    const result = await withPdfWorkerContext(s.context, () => auditAndRepairSource({ ...s.f, images: s.images, failureMode: 'hold' }))
    expect(result.status).toBe('audited')
    expect(s.batchCall).not.toHaveBeenCalled()
    expect(s.saved.get(`batch-result:${key}`)).toBe(delivery)
  })
  it('reuses the completed pilot-era 6,000-token request without applying new reasoning settings retroactively', async () => {
    const s = fixture()
    const request = { operation: 'source_audit', round: 1, source: sourceMapEvidence(s.f.pages), mapping: s.f.mapping,
      candidate: sourceAuditEvidence(s.f.draft), candidate_hash: sourceDraftHash(s.f.draft) }
    const old = s.oldOptions(SOURCE_AUDIT_REPAIR_PROMPT, request, 6000), key = llmCallKey(old, s.execution)
    const delivery = { result: s.result({ ...pass, repair: null }) }
    s.saved.set(`batch-result:${key}`, delivery)
    expect((await s.run()).status).toBe('audited')
    expect(s.batchCall).not.toHaveBeenCalled()
    expect(s.saved.get(`batch-result:${key}`)).toBe(delivery)
  })
  it('preserves a truncated pilot response and requests a separately bounded, no-upfront-thinking comparison', async () => {
    const s = fixture()
    const request = { operation: 'source_audit', round: 1, source: sourceMapEvidence(s.f.pages), mapping: s.f.mapping,
      candidate: sourceAuditEvidence(s.f.draft), candidate_hash: sourceDraftHash(s.f.draft) }
    const old = s.oldOptions(SOURCE_AUDIT_REPAIR_PROMPT, request, 6000), oldKey = llmCallKey(old, s.execution)
    // Even syntactically valid JSON with a pass cannot certify a truncated reply.
    const truncated = { ...s.result({ ...pass, repair: null }), stopReason: 'max_tokens', finishReason: 'length' as const }
    const oldDelivery = { result: truncated }
    s.saved.set(`batch-result:${oldKey}`, oldDelivery)
    s.context.cacheOnly = false
    await expect(s.run()).rejects.toBeInstanceOf(PdfBatchPending)
    const [options, newKey] = s.batchCall.mock.calls[0]
    expect(options).toMatchObject({ maxTokens: 6000, reasoning: { type: 'between_tools', effort: 'high' },
      bookOperation: { evidence: { outputPolicy: SOURCE_OUTPUT_POLICY } } })
    expect(newKey).not.toBe(oldKey)
    expect(buildAnthropicRequest(options, getModel(MODEL_IDS.sonnet55)!)).toMatchObject({
      thinking: { type: 'between_tools' }, output_config: { effort: 'high' }, max_tokens: 6000,
    })
    expect(s.saved.get(`batch-result:${oldKey}`)).toBe(oldDelivery)
    await expect(s.run()).rejects.toBeInstanceOf(PdfBatchPending)
    const [again, againKey] = s.batchCall.mock.calls[1]
    expect(againKey).toBe(newKey)
    expect(bookRequestIdentity(again, 'doc', 'unit-1')).toBe(bookRequestIdentity(options, 'doc', 'unit-1'))
    s.batchCall.mockImplementation(async () => s.result({ ...pass, repair: null }))
    expect((await s.run()).status).toBe('audited')
  })
  it('does not parse or automatically enlarge another truncated response on repeated restarts', async () => {
    const s = fixture()
    s.batchCall.mockResolvedValue({ ...s.result({ ...pass, repair: null }), text: '', stopReason: 'max_tokens', finishReason: 'length' })
    for (let n = 0; n < 2; n++) {
      await expect(s.run()).rejects.toBeInstanceOf(SourceOutputIncompleteError)
      expect(s.batchCall.mock.calls[n][0].maxTokens).toBe(6000)
    }
    expect(s.batchCall.mock.calls[0][1]).toBe(s.batchCall.mock.calls[1][1])
    expect(s.batchCall).toHaveBeenCalledTimes(2) // same delivery; no alternate request
  })
  it('reuses an original combined Sonnet response with omitted repair:null after prompt/model catalog changes', async () => {
    const s = fixture(), historic = { ...s.execution, configVersion: 'routing-v1:4aed6b2450f3' }
    const request = { operation: 'source_audit', round: 1, source: sourceMapEvidence(s.f.pages), mapping: s.f.mapping, candidate: sourceAuditEvidence(s.f.draft), candidate_hash: sourceDraftHash(s.f.draft) }
    const options = s.oldOptions(LEGACY_COMPACT_SOURCE_AUDIT_REPAIR_PROMPT, request, 6000)
    const key = llmCallKey(options, historic)
    const value = s.result(pass); value.execution.configVersion = historic.configVersion; value.execution.callKey = key
    s.saved.set('batch-result:' + key, { result: value })
    expect((await s.run()).status).toBe('audited')
    expect(s.batchCall).not.toHaveBeenCalled()
  })
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
