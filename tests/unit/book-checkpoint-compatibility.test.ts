import { describe, expect, it, vi } from 'vitest'
import { createLlmExecution, llmCallKey } from '@/lib/llm/client'
import { readCachedBookCall } from '@/lib/book-pdf/checkpoints'
import { withPdfWorkerContext } from '@/lib/pdf-import/context'
import type { CallLlmOptions, LlmDetailedResult } from '@/lib/llm/types'

describe('deployed textbook checkpoint compatibility', () => {
  it('skips truncated old audit replies without deleting or aliasing them, while reading the next complete version', async () => {
    const execution = createLlmExecution(), saved = new Map<string, unknown>(), remember = vi.fn()
    const old: CallLlmOptions = { task: 'book.auditSource', maxTokens: 6000, content: 'old audit', execution }
    const next = { ...old, content: 'new audit' }
    const result = (text: string, stopReason: string) => ({ text, stopReason, finishReason: stopReason === 'max_tokens' ? 'length' : 'complete',
      execution: { task: old.task, requestedModel: execution.taskBindings[old.task], configVersion: execution.configVersion } }) as LlmDetailedResult
    const truncated = result('', 'max_tokens'), complete = result('{"status":"pass"}', 'end_turn')
    saved.set(`batch-result:${llmCallKey(old, execution)}`, { result: truncated })
    saved.set(`batch-result:${llmCallKey(next, execution)}`, { result: complete })
    await withPdfWorkerContext({ signal: new AbortController().signal, concurrency: 1, execute: f => f(), stage: async () => {},
      read: async <T>(key: string) => (saved.get(key) ?? null) as T | null, write: async () => {}, rememberBookCall: remember,
      batchCall: async () => { throw Error('NETWORK_FORBIDDEN') },
    }, async () => {
      expect(await readCachedBookCall([old, next], { ignoreTruncated: true })).toBe(complete)
      expect(remember).toHaveBeenCalledExactlyOnceWith(next, llmCallKey(next, execution), complete)
      expect(await readCachedBookCall([old])).toBe(truncated)
      expect(saved.size).toBe(2)
    })
  })
  it('reuses exact historic evidence after a routing fingerprint changes, without a call', async () => {
    const current = { ...createLlmExecution(), configVersion: 'routing-v1:new-catalog' }
    const options: CallLlmOptions = { task: 'book.mapSource', maxTokens: 12000, content: [{ type: 'pdf', data: 'PDF-A', mimeType: 'application/pdf' }, { type: 'text', text: 'historic prompt' }], execution: current }
    const old = { ...current, taskBindings: { ...current.taskBindings, 'book.mapSource': 'claude-sonnet-5-5' }, configVersion: 'routing-v1:4aed6b2450f3' }
    const key = llmCallKey(options, old)
    const result = { text: '{"groups":[]}', execution: { task: options.task, requestedModel: old.taskBindings[options.task], configVersion: old.configVersion, callKey: key } } as LlmDetailedResult
    let calls = 0
    await withPdfWorkerContext({ cacheOnly: true, signal: new AbortController().signal, concurrency: 1, execute: f => f(), stage: async () => {}, write: async () => {},
      read: async <T>(k: string) => k === 'batch-result:' + key ? { result } as T : null,
      batchCall: async () => { calls++; throw Error('NETWORK_FORBIDDEN') },
    }, async () => {
      expect(await readCachedBookCall([options])).toBe(result)
      expect(await readCachedBookCall([{ ...options, content: 'different PDF or coordinates' }])).toBeNull()
      result.execution.callKey = 'wrong'
      expect(await readCachedBookCall([options])).toBeNull()
    })
    expect(calls).toBe(0)
  })
})
