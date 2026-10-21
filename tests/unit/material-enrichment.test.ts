import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extraction } from '../fixtures/book-pdf'
const mock = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/lib/llm/client', async (original) => ({ ...await original<typeof import('@/lib/llm/client')>(), callLlmTextDetailed: mock.call }))
import { enrichVerifiedMaterial, EXPLANATION_WRITING_RULES, validateMaterialSupplement } from '@/lib/llm/material-enrichment'
beforeEach(() => vi.clearAllMocks())
const supplement = { questions: [{ key: '1:exercise:1', solution: '정답의 근거 설명', vocabulary: 'intact 온전한' }] }
describe('shared supplementary explanation and vocabulary', () => {
  it('only returns generated supplementary fields, leaving original data untouched', async () => {
    mock.call.mockResolvedValue({ text: JSON.stringify(supplement), stopReason: 'end_turn' })
    const source = structuredClone(extraction)
    expect(await enrichVerifiedMaterial(source)).toEqual(supplement)
    expect(source).toEqual(extraction)
    const request = mock.call.mock.calls[0][0]
    expect(request.content.every((c: {type: string}) => c.type === 'text')).toBe(true)
    expect(request.content[0].text).toContain(EXPLANATION_WRITING_RULES)
  })
  it('rejects invented keys, duplicates and attempts to change the answer', () => {
    expect(() => validateMaterialSupplement(extraction,{ questions: [{ ...supplement.questions[0], key:'wrong' }] })).toThrow()
    expect(() => validateMaterialSupplement(extraction,{ questions: [...supplement.questions,...supplement.questions] })).toThrow()
    expect(() => validateMaterialSupplement(extraction,{ questions: [{ ...supplement.questions[0], answer:5 }] })).toThrow()
  })
  it('rejects empty explanations and executable markup, while allowing no extra vocabulary', () => {
    expect(() => validateMaterialSupplement(extraction,{ questions: [{ ...supplement.questions[0], solution:' ' }] })).toThrow()
    expect(() => validateMaterialSupplement(extraction,{ questions: [{ ...supplement.questions[0], solution:'<script>x</script>' }] })).toThrow()
    expect(validateMaterialSupplement(extraction,{ questions: [{ ...supplement.questions[0], vocabulary:'' }] }).questions[0].vocabulary).toBe('')
  })
  it('rejects truncated output', async () => {
    mock.call.mockResolvedValue({ text: JSON.stringify(supplement), stopReason:'max_tokens' })
    await expect(enrichVerifiedMaterial(extraction)).rejects.toThrow('완결')
  })
  it('repairs a malformed supplement once without repeating source extraction', async () => {
    const bad = { questions: [{ ...supplement.questions[0], ' vocabulary': '' }] }
    mock.call.mockResolvedValueOnce({ text: JSON.stringify(bad), stopReason: 'end_turn' })
      .mockResolvedValueOnce({ text: JSON.stringify(supplement), stopReason: 'end_turn' })
    expect(await enrichVerifiedMaterial(extraction)).toEqual(supplement)
    expect(mock.call).toHaveBeenCalledTimes(2)
    expect(mock.call.mock.calls[1][0].content.at(-1).text).toContain('previous')
    expect(mock.call.mock.calls[1][0].content.every((c: {type: string}) => c.type === 'text')).toBe(true)
  })
  it('holds after one failed supplement repair and propagates network errors directly', async () => {
    mock.call.mockResolvedValue({ text: JSON.stringify({questions:[{...supplement.questions[0],answer:5}]}), stopReason:'end_turn' })
    await expect(enrichVerifiedMaterial(extraction)).rejects.toThrow()
    expect(mock.call).toHaveBeenCalledTimes(2)
    mock.call.mockReset().mockRejectedValue(Error('network'))
    await expect(enrichVerifiedMaterial(extraction)).rejects.toThrow('network')
    expect(mock.call).toHaveBeenCalledTimes(1)
  })
})
