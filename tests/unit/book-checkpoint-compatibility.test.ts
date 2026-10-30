import { describe, expect, it } from 'vitest'
import { createLlmExecution, llmCallKey } from '@/lib/llm/client'
import { readCachedBookCall } from '@/lib/book-pdf/checkpoints'
import { withPdfWorkerContext } from '@/lib/pdf-import/context'
import type { CallLlmOptions, LlmDetailedResult } from '@/lib/llm/types'

describe('deployed textbook checkpoint compatibility', () => {
  it('reuses exact historic evidence after a routing fingerprint changes, without a call', async () => {
    const current = { ...createLlmExecution(), configVersion: 'routing-v1:new-catalog' }
    const options: CallLlmOptions = { task: 'book.mapSource', maxTokens: 12000, content: [{ type: 'pdf', data: 'PDF-A', mimeType: 'application/pdf' }, { type: 'text', text: 'historic prompt' }], execution: current }
    const old = { ...current, configVersion: 'routing-v1:4aed6b2450f3' }
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
