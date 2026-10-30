import { describe, expect, it, vi } from 'vitest'
import { nativeFixture } from '../fixtures/book-native'
const mocks = vi.hoisted(() => ({ read: vi.fn(), call: vi.fn() }))
vi.mock('@/lib/book-pdf/checkpoints', () => ({ readCachedBookCall: mocks.read }))
vi.mock('@/lib/llm/client', async original => ({ ...await original<typeof import('@/lib/llm/client')>(), callLlmTextDetailed: mocks.call }))
import { mapBookSource } from '@/lib/book-pdf/map-source'

describe('selecting an existing compatible mapping', () => {
  it('tries the paid layout candidate when the current-format candidate has invalid ranges', async () => {
    const f = nativeFixture(), bad = structuredClone(f.mapping)
    bad.groups[0].passage = [{ s: 999999, e: 999999 }]
    const response = (mapping: unknown) => ({ text: JSON.stringify(mapping), stopReason: 'end_turn', usage: {} })
    mocks.read.mockResolvedValueOnce(response(bad)).mockResolvedValueOnce(response(f.mapping))
    const result = await mapBookSource({ pages: f.pages, pdf: 'same PDF', targets: f.unit.questions.map(({ key, label }) => ({ key, label })) })
    expect(result.resolved.errors).toEqual([])
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.call).not.toHaveBeenCalled()
  })
})
