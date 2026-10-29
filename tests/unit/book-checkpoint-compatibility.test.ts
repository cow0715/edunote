import { describe, expect, it, vi } from 'vitest'
import { readCachedBookCall } from '@/lib/book-pdf/checkpoints'
import { parseSourceAuditResponse } from '@/lib/book-pdf/source-audit-state'
import { callLlmTextDetailed, createLlmExecution, llmCallKey } from '@/lib/llm/client'
import { withPdfWorkerContext, type PdfWorkerContext } from '@/lib/pdf-import/context'
import type { CallLlmOptions, LlmDetailedResult } from '@/lib/llm/types'
import { LEGACY_LAYOUT_SOURCE_MAP_PROMPT, LEGACY_LAYOUT_SOURCE_AUDIT_PROMPT, LEGACY_LAYOUT_SOURCE_REPAIR_PROMPT } from '@/lib/book-pdf/legacy-prompts'

const execution = createLlmExecution()
const options = (content: string): CallLlmOptions => ({ task: 'book.mapSource', content, maxTokens: 12000, stream: true })
function context(saved: Map<string, unknown>): PdfWorkerContext {
  return { cacheOnly: true, signal: new AbortController().signal, concurrency: 1, execute: (fn) => fn(), stage: async () => {},
    read: async <T>(key: string) => (saved.get(key) ?? null) as T | null, write: vi.fn(), batchCall: vi.fn(async () => { throw Error('New request forbidden') }) }
}
describe('paid textbook response compatibility', () => {
  it('uses the LF text actually sent by deployed template literals, rather than CRLF source-file bytes', () => {
    for (const prompt of [LEGACY_LAYOUT_SOURCE_MAP_PROMPT,LEGACY_LAYOUT_SOURCE_AUDIT_PROMPT,LEGACY_LAYOUT_SOURCE_REPAIR_PROMPT]) {
      expect(prompt).toContain('\n');expect(prompt).not.toContain('\r')
    }
  })
  it('reads an exact legacy request delivery without generating or copying a paid result', async () => {
    const prior = options('same PDF and coordinates; layout-v1 prompt'), current = options('same PDF and coordinates; current prompt')
    const result = { text: '{}', execution: { task: prior.task, requestedModel: execution.taskBindings[prior.task] } } as LlmDetailedResult
    const saved = new Map<string, unknown>([[`batch-result:${llmCallKey(prior, execution)}`, { result }]])
    const ctx = context(saved)
    expect(await withPdfWorkerContext(ctx, () => readCachedBookCall([current, prior]))).toBe(result)
    expect(ctx.batchCall).not.toHaveBeenCalled(); expect(ctx.write).not.toHaveBeenCalled()
    expect(await withPdfWorkerContext(ctx, () => readCachedBookCall([options('different PDF and coordinates')]))).toBeNull()
  })
  it('blocks uncached direct generation and prewarm in cache-only recovery', async () => {
    const ctx = context(new Map()); delete ctx.batchCall
    await expect(withPdfWorkerContext(ctx, () => callLlmTextDetailed(options('missing')))).rejects.toThrow('추가 비용 방지')
    await expect(withPdfWorkerContext(ctx, () => callLlmTextDetailed({ ...options('prewarm'), phase: 'prewarm', maxTokens: 0 }))).rejects.toThrow('예열')
  })
  it('removes only duplicated identical audit target addresses and leaves repairs required', () => {
    const target = { g: 0, q: null, field: 'translation', choice: null }
    const issue = { ...target, target, kind: 'formatting', pages: [40], reason: 'underline missing' }
    const audit = { status: 'repair', checks: { content: true, mapping: true, formatting: false, inventory: true }, issues: [issue] }
    const result = parseSourceAuditResponse(audit)
    expect(result.success).toBe(true)
    if (result.success) { expect(result.data.status).toBe('repair'); expect(result.data.issues[0]).not.toHaveProperty('g') }
    expect(audit.issues[0]).toHaveProperty('g', 0)
    expect(parseSourceAuditResponse({ ...audit, issues: [{ ...issue, g: 1 }] }).success).toBe(false)
    expect(parseSourceAuditResponse({ ...audit, issues: [{ ...issue, invented: true }] }).success).toBe(false)
  })
})
