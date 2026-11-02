import { describe, expect, it } from 'vitest'
import { bookUnitStageKey, readBookUnitStage, writeBookUnitStage } from '@/lib/book-pdf/unit-progress'
import { bookRequestIdentity } from '@/lib/book-pdf/request-identity'
import { withPdfWorkerContext, type PdfWorkerContext } from '@/lib/pdf-import/context'
import { createLlmExecution, llmCallKey } from '@/lib/llm/client'
import type { CallLlmOptions } from '@/lib/llm/types'

const scope = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }
describe('textbook stage durability and evidence identity', () => {
  it('preserves candidate key order through JSONB and uses a separate mutable store', async () => {
    const saved = new Map<string, unknown>(), order: string[] = []
    const context: PdfWorkerContext = { signal: new AbortController().signal, concurrency: 1, execute: fn => fn(), stage: async () => {},
      read: async <T,>(key: string) => saved.get(key) as T ?? null,
      write: async () => { throw Error('immutable store must not be replaced') },
      writeBookProgress: async (key, value) => { order.push(key); saved.set(key, JSON.parse(JSON.stringify(value))) } }
    const candidate = { z: 'text', a: { z: 1, a: 2 }, optional: undefined }
    await withPdfWorkerContext(context, async () => {
      await writeBookUnitStage(scope, 'mapping', candidate)
      await writeBookUnitStage(scope, 'mapping', { ...candidate, repaired: true })
      expect(await readBookUnitStage(scope, 'mapping')).toEqual({ ...candidate, repaired: true })
      expect(JSON.stringify(await readBookUnitStage(scope, 'mapping'))).toBe(JSON.stringify({ ...candidate, repaired: true }))
      const key = bookUnitStageKey(scope, 'mapping'), envelope = saved.get(key) as { hash: string }
      envelope.hash = 'corrupt'
      await expect(readBookUnitStage(scope, 'mapping')).rejects.toThrow('복원하지 못해')
    })
    expect(order).toHaveLength(2)
    expect(bookUnitStageKey({ ...scope, pdfHash: 'c'.repeat(64) }, 'mapping')).not.toBe(order[0])
  })
  it('excludes prompts/routing from semantic identity without changing old exact request keys', () => {
    const options: CallLlmOptions = { task: 'book.mapSource', content: 'old prompt', maxTokens: 100, execution: createLlmExecution() }
    const annotated = { ...options, bookOperation: { kind: 'mapping' as const, evidence: { pages: [1], source: 'original' } } }
    const changed = { ...annotated, content: 'new prompt', maxTokens: 999, execution: { ...options.execution!, configVersion: 'new-routing' } }
    expect(llmCallKey(options, options.execution!)).toBe(llmCallKey(annotated, annotated.execution!))
    expect(bookRequestIdentity(annotated, 'doc', 'unit-1')).toBe(bookRequestIdentity(changed, 'doc', 'unit-1'))
    for (const candidate of [{ ...changed, bookOperation: { kind: 'mapping_repair' as const, evidence: annotated.bookOperation.evidence } },
      { ...changed, bookOperation: { kind: 'mapping' as const, evidence: { pages: [1], source: 'different' } } }]) {
      expect(bookRequestIdentity(candidate, 'doc', 'unit-1')).not.toBe(bookRequestIdentity(annotated, 'doc', 'unit-1'))
    }
    expect(bookRequestIdentity(annotated, 'other-doc', 'unit-1')).not.toBe(bookRequestIdentity(annotated, 'doc', 'unit-1'))
    expect(bookRequestIdentity(annotated, 'doc', 'unit-2')).not.toBe(bookRequestIdentity(annotated, 'doc', 'unit-1'))
  })
})
