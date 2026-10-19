import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn(), construct: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() { sdk.construct() }
    messages = { create: sdk.create, stream: sdk.stream }
  },
}))

import { buildFileBlock, callLlmText, callLlmTextDetailed, createLlmExecution, isContentFilterError, isTaskConfigured, LlmError } from '../../src/lib/llm/client'
import * as models from '../../src/lib/llm/models'
import { parseJsonObjectResponse } from '../../src/lib/llm/json'

const response = (overrides: Record<string, unknown> = {}) => ({
  model: 'provider-resolved-snapshot', stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'first' }, { type: 'thinking', thinking: 'private' }, { type: 'text', text: 'second' }],
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 300 },
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ANTHROPIC_API_KEY', 'mock-key')
  sdk.create.mockResolvedValue(response())
  sdk.stream.mockReturnValue({ finalMessage: vi.fn().mockResolvedValue(response()) })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('task routing and isolation', () => {
  it('imports and checks pure helpers without creating a client or requiring a key', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(isTaskConfigured('vocab.gradeMeaning')).toBe(false)
    expect(parseJsonObjectResponse('{"ok":true}')).toEqual({ ok: true })
    expect(createLlmExecution().taskBindings['examBank.extractExplanations']).toBe('claude-sonnet-5')
    expect(sdk.construct).not.toHaveBeenCalled()
  })

  it('freezes each task binding and applies an override only to that execution', async () => {
    const override = { 'vocab.gradeMeaning': 'claude-sonnet-4-6' } as const
    const selected = createLlmExecution(override)
    const normal = createLlmExecution()
    expect(Object.isFrozen(selected)).toBe(true)
    expect(Object.isFrozen(selected.taskBindings)).toBe(true)
    expect(selected.taskBindings['vocab.answerOcr']).toBe('claude-sonnet-5')
    expect(normal.taskBindings['vocab.gradeMeaning']).toBe('claude-haiku-4-5-20251001')
    expect(selected.configVersion).not.toBe(normal.configVersion)
    await Promise.all([
      callLlmText({ task: 'vocab.gradeMeaning', execution: selected, maxTokens: 8192, content: 'grade' }),
      callLlmText({ task: 'vocab.gradeMeaning', execution: normal, maxTokens: 8192, content: 'grade' }),
    ])
    expect(sdk.create.mock.calls.map(([params]) => params.model)).toEqual(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'])
    expect(selected.calls).toHaveLength(1)
    expect(normal.calls).toHaveLength(1)
  })

  it('rejects unknown task and model overrides before any request', () => {
    expect(() => createLlmExecution({ 'vocab.gradeMeaning': 'made-up-model' })).toThrow(LlmError)
    expect(() => createLlmExecution({ unknown: 'claude-sonnet-5' } as never)).toThrow(LlmError)
    expect(sdk.create).not.toHaveBeenCalled()
  })
})

describe('Anthropic request preservation', () => {
  it('preserves file order, cached prefix, output limit and omission of unsupported temperature', async () => {
    await callLlmText({
      task: 'week.parseAnswers', maxTokens: 8192, temperature: 0, cacheBoundary: 1,
      content: [buildFileBlock('pdf-data', 'application/pdf'), { type: 'text', text: 'rules' }, { type: 'text', text: 'only 3' }],
    })
    expect(sdk.create.mock.calls[0][0]).toEqual({
      model: 'claude-sonnet-5', max_tokens: 8192,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'pdf-data' } },
        { type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'only 3' },
      ] }],
    })
  })

  it('uses the same task binding for zero-output prewarm and generated ranges', async () => {
    const execution = createLlmExecution({ 'examBank.parseQuestions': 'claude-sonnet-4-6' })
    const prefix = [buildFileBlock('pdf-data', 'application/pdf'), { type: 'text' as const, text: 'rules' }]
    await callLlmTextDetailed({ task: 'examBank.parseQuestions', execution, phase: 'prewarm', maxTokens: 0, cacheBoundary: 1, content: prefix })
    await callLlmText({ task: 'examBank.parseQuestions', execution, maxTokens: 8192, cacheBoundary: 1, content: [...prefix, { type: 'text', text: 'question 18' }] })
    const calls = sdk.create.mock.calls.map(([params]) => params)
    expect(calls.map((params) => params.model)).toEqual(['claude-sonnet-4-6', 'claude-sonnet-4-6'])
    expect(calls.map((params) => params.max_tokens)).toEqual([0, 8192])
    expect(calls[1].messages[0].content.slice(0, 2)).toEqual(calls[0].messages[0].content)
    expect(execution.calls.map((call) => call.phase)).toEqual(['prewarm', 'generate'])
  })

  it('preserves image serialization, supported sampling and buffered streaming with cancellation', async () => {
    const signal = new AbortController().signal
    const result = await callLlmTextDetailed({ task: 'vocab.sheetName', maxTokens: 512, temperature: 0, stream: true, signal, content: [buildFileBlock('image-data', 'image/png')] })
    expect(sdk.create).not.toHaveBeenCalled()
    expect(sdk.stream.mock.calls[0]).toEqual([{
      model: 'claude-haiku-4-5-20251001', max_tokens: 512, temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'image-data' } }] }],
    }, { signal }])
    expect(result.text).toBe('first\nsecond')
    expect(result.execution.responseModel).toBe('provider-resolved-snapshot')
  })

  it('rejects incompatible capabilities and invalid limits before the SDK request', async () => {
    const original = models.getModel
    vi.spyOn(models, 'getModel').mockImplementation((id) => {
      const entry = original(id)
      return entry ? { ...entry, capabilities: { ...entry.capabilities, pdf: false } } : undefined
    })
    await expect(callLlmText({ task: 'week.parseAnswers', maxTokens: 8192, content: [buildFileBlock('pdf', 'application/pdf')] })).rejects.toMatchObject({ kind: 'unsupported' })
    await expect(callLlmText({ task: 'sms.write', maxTokens: 0, content: 'sms' })).rejects.toMatchObject({ kind: 'input_limit' })
    await expect(callLlmText({ task: 'sms.write', maxTokens: 32769, content: 'sms' })).rejects.toMatchObject({ kind: 'input_limit' })
    await expect(callLlmText({ task: 'sms.write', maxTokens: 20, content: 'sms', cacheBoundary: 0 })).rejects.toMatchObject({ kind: 'unsupported' })
    expect(() => buildFileBlock('svg', 'image/svg+xml')).toThrow(LlmError)
    expect(sdk.create).not.toHaveBeenCalled()
  })
})

describe('results, errors and telemetry', () => {
  it('retains raw truncation detection alongside its neutral finish reason', async () => {
    sdk.create.mockResolvedValue(response({ stop_reason: 'max_tokens' }))
    const result = await callLlmTextDetailed({ task: 'vocab.gradeMeaning', maxTokens: 8192, content: 'student private answer' })
    expect(result.stopReason).toBe('max_tokens')
    expect(result.finishReason).toBe('length')
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 200, cacheWriteTokens: 300 })
    const log = vi.mocked(console.log).mock.calls[0][1] as string
    expect(log).not.toContain('student private answer')
    expect(JSON.parse(log).promptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(log)).toMatchObject({ promptVersion: 'vocab-grade-v1', schemaVersion: 'vocab-grade-v1' })
  })

  it('throws refusal for existing isolation paths and retains billed usage and actual model', async () => {
    const execution = createLlmExecution()
    sdk.create.mockResolvedValue(response({ stop_reason: 'refusal' }))
    const error = await callLlmText({ task: 'week.parseAnswers', execution, maxTokens: 8192, content: 'rules' }).catch((value: unknown) => value)
    expect(isContentFilterError(error)).toBe(true)
    expect(error).toMatchObject({ kind: 'refusal', usage: { inputTokens: 100 }, execution: { responseModel: 'provider-resolved-snapshot' } })
    expect(execution.calls).toHaveLength(1)
    expect(execution.calls[0]).toMatchObject({ finishReason: 'refusal', errorKind: 'refusal', usage: { outputTokens: 20 } })
    expect(isContentFilterError(new Error('Output blocked by content filtering'))).toBe(true)
  })

  it.each([
    [401, 'Error', 'authentication'], [429, 'Error', 'rate_limit'], [413, 'Error', 'input_limit'],
    [undefined, 'APIConnectionError', 'network'], [undefined, 'APIConnectionTimeoutError', 'timeout'], [undefined, 'APIUserAbortError', 'cancelled'],
  ])('classifies status %s / %s without adding retries', async (status, name, kind) => {
    const cause = Object.assign(new Error('provider failed'), { status, name })
    sdk.create.mockRejectedValue(cause)
    await expect(callLlmText({ task: 'sms.write', maxTokens: 512, content: 'rules' })).rejects.toMatchObject({ kind, usage: null })
    expect(sdk.create).toHaveBeenCalledTimes(1)
  })

  it('calculates cache pricing from distinct token buckets and keeps unavailable cost unknown', () => {
    expect(models.estimateLlmCost('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })).toBeCloseTo(14.7)
    expect(models.estimateLlmCost('unknown', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull()
    expect(models.estimateLlmCost('claude-sonnet-5', { inputTokens: 100, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: 0 })).toBeNull()
  })

  it('rejects browser imports before constructing a provider client', async () => {
    vi.resetModules()
    vi.stubGlobal('window', {})
    await expect(import('../../src/lib/llm/client')).rejects.toMatchObject({ kind: 'configuration' })
    expect(sdk.construct).not.toHaveBeenCalled()
  })
})
