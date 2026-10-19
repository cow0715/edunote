import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/lib/llm/client', () => ({ MODELS: { parse: 'test-model' }, callLlmTextDetailed: mock.call,
  buildFileBlock: () => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'test' } }),
  parseJsonObjectResponse: (text: string) => JSON.parse(text) }))
import { mapBookSource } from '@/lib/book-pdf/map-source'

beforeEach(() => { mock.call.mockReset() })
describe('source mapping model response handling', () => {
  it('keeps an invalid schema unresolved so only that window can be repaired', async () => {
    mock.call.mockResolvedValue({ text: JSON.stringify({ groups: [], ignored: [{ refs: [], reason: 'choice_marker' }], issues: [] }), stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    const r = await mapBookSource({ pages: [], pdf: 'test' })
    expect(r.resolved.status).toBe('unresolved')
    expect(r.resolved.errors.some((e) => e.startsWith('mapping_schema:ignored.0.reason:'))).toBe(true)
    expect(mock.call).toHaveBeenCalledTimes(1)
  })
  it('retains malformed JSON as an unresolved candidate rather than inventing data', async () => {
    mock.call.mockResolvedValue({ text: 'incomplete JSON', stopReason: 'end_turn', usage: {} })
    const r = await mapBookSource({ pages: [], pdf: 'test' })
    expect(r.mapping).toBe('incomplete JSON')
    expect(r.resolved.groups).toEqual([])
    expect(r.resolved.status).toBe('unresolved')
  })
  it('rejects truncated output', async () => {
    mock.call.mockResolvedValue({ text: '{}', stopReason: 'max_tokens', usage: {} })
    await expect(mapBookSource({ pages: [], pdf: 'test' })).rejects.toThrow('not complete')
  })
  it('does not introduce provider prompt caching or expected answers into the evidence', async () => {
    mock.call.mockResolvedValue({ text: '{}', stopReason: 'end_turn', usage: {} })
    await mapBookSource({ pages: [], pdf: 'test' })
    const request = mock.call.mock.calls[0][0]
    expect(request.content.some((b: object) => 'cache_control' in b)).toBe(false)
    expect(JSON.parse(request.content.at(-1).text)).toEqual({ pages: [] })
  })
  it('falls back to the unchanged full mapping request when no safe code connections exist', async () => {
    mock.call.mockResolvedValue({ text: '{}', stopReason: 'end_turn', usage: {} })
    await mapBookSource({ pages: [], pdf: 'test', mode: 'hybrid' })
    const request = mock.call.mock.calls[0][0]
    expect(JSON.parse(request.content.at(-1).text)).toEqual({ pages: [] })
    expect(request.content[1].text).not.toContain('추가 규칙:')
  })
})
