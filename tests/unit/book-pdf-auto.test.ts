import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compareBookExtractions } from '@/lib/book-pdf/agreement'
import { bookFingerprint, bookProofMatches } from '@/lib/book-pdf/proof'
import { validateBookUnit } from '@/lib/book-pdf/validation'
import { normalizeBookExtraction } from '@/lib/book-pdf/text'
import { checks, draft, extraction, manifest, pdfHash } from '../fixtures/book-pdf'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/lib/llm/client', async (original) => ({ ...await original<typeof import('@/lib/llm/client')>(), callLlmTextDetailed: mocks.call }))
import { verifyAndRepairBookUnit } from '@/lib/book-pdf/verify'
const input = { unit: manifest.units[0], pdfHash, chapterFile: 'chapter', chapterPages: [1, 2], contextFile: 'unit-and-neighbors', contextPages: [1, 2] }
const response = (value: unknown) => ({ text: JSON.stringify(value), stopReason: 'end_turn' })
const blind = (value = extraction, extra = {}) => response({ extraction: value, checks, issues: [], ...extra })
beforeEach(() => { vi.clearAllMocks() })
describe('automatic independent verification and repair', () => {
  it('accepts two source readings only when their complete fields and native checks agree', async () => {
    mocks.call.mockResolvedValueOnce(response(extraction)).mockResolvedValueOnce(blind())
    const result = await verifyAndRepairBookUnit(input)
    expect(result.verification.status).toBe('passed')
    expect(result.verification.attempts).toBe(1)
    expect(mocks.call.mock.calls[0][0].execution.taskBindings['book.verifyLegacy']).not.toBe(mocks.call.mock.calls[1][0].execution.taskBindings['book.verifyLegacy'])
    const blindRequest = JSON.parse(mocks.call.mock.calls[1][0].content.at(-1).text)
    expect(blindRequest).not.toHaveProperty('candidate')
    expect(JSON.stringify(blindRequest)).not.toContain('printed_answer')
    expect(result.verification.extraction_hash).toBe(bookFingerprint(extraction))
  })
  it('repairs a wrong printed answer automatically and requires a fresh confirming pass', async () => {
    const wrong = { ...extraction, questions: [{ ...extraction.questions[0], answer: 3 }] }
    mocks.call.mockResolvedValueOnce(response(wrong)).mockResolvedValueOnce(blind()).mockResolvedValueOnce(blind())
    const result = await verifyAndRepairBookUnit(input)
    expect(result.extraction?.questions[0].answer).toBe(2)
    expect(result.verification).toMatchObject({ status: 'passed', attempts: 2 })
  })
  it('detects lost underline markup, repairs the affected unit, then confirms it independently', async () => {
    const lost = structuredClone(extraction), correct = { ...extraction, passage: 'Every source sentence must be kept <u>completely</u> intact.' }
    mocks.call.mockResolvedValueOnce(response(lost)).mockResolvedValueOnce(blind(correct)).mockResolvedValueOnce(response(correct)).mockResolvedValueOnce(blind(correct))
    expect((await verifyAndRepairBookUnit(input)).verification).toMatchObject({ status: 'passed', attempts: 2 })
    const repair = JSON.parse(mocks.call.mock.calls[2][0].content.at(-1).text)
    expect(repair.issues).toContain('독립 추출 불일치: passage')
    expect(repair.native_source.left).toBe(manifest.units[0].left_text)
  })
  it('never approves a repair that the next blind extraction disagrees with', async () => {
    const other = { ...extraction, passage: extraction.passage.replace('intact', '<u>intact</u>') }
    mocks.call.mockResolvedValueOnce(response(extraction)).mockResolvedValueOnce(blind(other)).mockResolvedValueOnce(response(extraction))
      .mockResolvedValueOnce(blind(other)).mockResolvedValueOnce(response(extraction)).mockResolvedValueOnce(blind(other))
    const result = await verifyAndRepairBookUnit(input)
    expect(result.verification).toMatchObject({ status: 'unresolved', attempts: 3 })
    expect(mocks.call).toHaveBeenCalledTimes(6)
  })
  it('does not pass unreadable sources or incomplete page boundaries even when both texts agree', async () => {
    mocks.call.mockResolvedValueOnce(response(extraction)).mockResolvedValue(blind(extraction, { checks: { ...checks, boundaries: false } }))
    const result = await verifyAndRepairBookUnit(input)
    expect(result.verification.status).toBe('unresolved')
    expect(result.verification.issues.join(' ')).toContain('boundaries')
  })
  it('automatically re-extracts malformed or truncated output rather than asking for manual input', async () => {
    mocks.call.mockResolvedValueOnce({ text: '{}', stopReason: 'max_tokens' }).mockResolvedValueOnce(blind()).mockResolvedValueOnce(blind())
    expect((await verifyAndRepairBookUnit(input)).verification.status).toBe('passed')
  })
  it('propagates network errors for durable worker retry', async () => {
    mocks.call.mockRejectedValue(Error('network'))
    await expect(verifyAndRepairBookUnit(input)).rejects.toThrow('network')
  })
  it('does not count failed model responses as independent supporting evidence', async () => {
    mocks.call.mockResolvedValueOnce(response({})).mockResolvedValueOnce(blind()).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({}))
    const result = await verifyAndRepairBookUnit(input)
    expect(result.verification.status).toBe('unresolved')
    expect(result.verification.models).toHaveLength(1)
  })
})
describe('machine proof and strict native invariants', () => {
  it('preserves order, choice assignment and formatting rather than comparing token bags', () => {
    expect(compareBookExtractions(extraction, { ...extraction, passage: extraction.passage.replace('source', '<u>source</u>') })).toContain('passage')
    expect(compareBookExtractions(extraction, { ...extraction, questions: [{ ...extraction.questions[0], choices: [...extraction.questions[0].choices].reverse() }] })).toContain('1:exercise:1:choices')
  })
  it('ignores printed question numbers and typographic quote variants, while preserving meaning and underline', () => {
    const source = { ...extraction, passage: 'He said, “keep it.”', questions: [{ ...extraction.questions[0], stem: '다음 글의 내용과 일치하지 않는 것은?' }] }
    const same = { ...source, passage: 'He said, "keep it."', questions: [{ ...source.questions[0], stem: '1 다음 글의 내용과 일치하지 않는 것은?' }] }
    expect(compareBookExtractions(source, same)).toEqual([])
    expect(compareBookExtractions(source, { ...same, passage: 'He said, "<u>keep</u> it."' })).toContain('passage')
    expect(compareBookExtractions(source, { ...same, questions: [{ ...same.questions[0], stem: '1 다음 글의 내용과 일치하는 것은?' }] })).toContain('1:exercise:1:stem')
  })
  it('compares equivalent rendered emphasis without overlooking missing bold or underline', () => {
    const value = { ...extraction, passage: '**(a) <u>her</u>** book' }
    expect(compareBookExtractions(value, { ...value, passage: '**(a)** **<u>her</u>** book' })).toEqual([])
    expect(compareBookExtractions(value, { ...value, passage: '**(a)** <u>**her**</u> book' })).toEqual([])
    expect(compareBookExtractions(value, { ...value, passage: '(a) <u>her</u> book' })).toContain('passage')
    expect(compareBookExtractions(value, { ...value, passage: '**(a) her** book' })).toContain('passage')
    expect(compareBookExtractions({ ...extraction, passage: '*resume: 이력서' }, { ...extraction, passage: '\\*resume: 이력서' })).toEqual([])
  })
  it('does not treat a printed stem number or square vocabulary bullets as missing content', () => {
    const stem = '다음 글의 내용과 일치하지 않는 것은?'
    const unit = { ...manifest.units[0], left_text: manifest.units[0].left_text.replace('발문', `1 ${stem}`), right_text: manifest.units[0].right_text.replace('[어휘]source 원문', '[어휘]\no source 원문') }
    const value = { ...extraction, questions: [{ ...extraction.questions[0], stem }] }
    expect(validateBookUnit(unit, value, true).errors).toEqual([])
    expect(validateBookUnit(unit, { ...value, vocabulary: 'source 다른뜻' }, true).errors.join(' ')).toContain('어휘')
    expect(validateBookUnit(unit, { ...value, questions: [{ ...value.questions[0], stem: '다음 글의 내용과 일치하는 것은?' }] }, true).errors.join(' ')).toContain('발문')
  })
  it('matches black circled inline option markers to their display equivalents', () => {
    const unit = { ...manifest.units[0], left_text: manifest.units[0].left_text.replace(extraction.questions[0].choices.join('\n'), '❶a\n❷b\n❸c\n❹d\n❺e') }
    expect(validateBookUnit(unit, extraction, true).errors).toEqual([])
  })
  it('does not count a next-question answer heading as part of the preceding explanation', () => {
    const unit = { ...manifest.units[0], right_text: manifest.units[0].right_text.replace('[어휘]', '2.\n[정답]⑤\n[어휘]') }
    expect(validateBookUnit(unit, extraction, true).errors).toEqual([])
    expect(validateBookUnit(unit, { ...extraction, questions: [{ ...extraction.questions[0], solution: '다른 해설' }] }, true).errors.join(' ')).toContain('해설')
  })
  it('normalizes shared-passage type aliases without changing question content', () => {
    const shared = { ...manifest.units[0], questions: [manifest.units[0].questions[0], { ...manifest.units[0].questions[0], key: '1:exercise:2' }] }
    const value = { ...extraction, questions: [{ ...extraction.questions[0], question_type: 'order' }] }
    expect(normalizeBookExtraction(shared, value).questions[0]).toMatchObject({ question_type: 'long_order', answer: 2, stem: '발문' })
    expect(normalizeBookExtraction(manifest.units[0], value).questions[0].question_type).toBe('order')
  })
  it('requires source-coordinate underline evidence even if two models both omit it', () => {
    const unit = { ...manifest.units[0], underlines: [{ page: 1, side: 'left' as const, text: 'completely', context: extraction.passage }] }
    expect(validateBookUnit(unit, extraction, true).errors.join(' ')).toContain('밑줄')
    expect(validateBookUnit(unit, { ...extraction, passage: extraction.passage.replace('completely', '<u>completely</u>') }, true).errors).toEqual([])
  })
  it('requires native bold-font evidence and accepts bold paragraph labels in their printed order', () => {
    const passage = '(A) Every source sentence must be kept completely intact.\n(B) More text.'
    const unit = { ...manifest.units[0], left_text: manifest.units[0].left_text.replace(extraction.passage, passage),
      bold: [{ page: 1, side: 'left' as const, text: '(A)', context: '(A)' }, { page: 1, side: 'left' as const, text: '(B)', context: '(B)' }] }
    const value = { ...extraction, passage: passage.replace('(A)', '**(A)**').replace('(B)', '**(B)**') }
    expect(validateBookUnit(unit, value, true).errors).toEqual([])
    expect(validateBookUnit(unit, { ...value, passage }, true).errors.join(' ')).toContain('굵은 표시')
    expect(validateBookUnit(unit, { ...value, passage: value.passage.split('\n').reverse().join('\n') }, true).errors.join(' ')).toContain('문단 기호')
  })
  it('checks explanation ownership within shared passages, even when both original explanations remain', () => {
    const first = '첫 문항은 글의 목적을 물어보는 문제입니다.', second = '둘째 문항은 지시 대상이 다른 것을 찾는 문제입니다.'
    const ref = manifest.units[0].questions[0]
    const unit = { ...manifest.units[0], questions: [ref, { ...ref, key: '1:exercise:2', number: 2, printed_answer: 5 }],
      left_text: manifest.units[0].left_text + '\n[수능특강(영어) 1강 2번]\n발문\n' + extraction.questions[0].choices.join('\n'),
      right_text: `[정답]②\n[소재]원문 소재\n[해석]원문 해석입니다.\n[해설]${first}\n2\n[정답]⑤\n[해설]${second}\n[어휘]source 원문` }
    const value = { ...extraction, questions: [{ ...extraction.questions[0], solution: first }, { ...extraction.questions[0], key: '1:exercise:2', answer: 5, solution: second }] }
    expect(validateBookUnit(unit, value, true).errors).toEqual([])
    const swapped = { ...value, questions: [{ ...value.questions[0], solution: second }, { ...value.questions[1], solution: first }] }
    expect(validateBookUnit(unit, swapped, true).errors.join(' ')).toContain('다른 문항과 연결')
    expect(validateBookUnit(unit, { ...value, questions: [value.questions[0], { ...value.questions[1], intent: '' }] }, true).errors.join(' ')).toContain('소재')
  })
  it('invalidates proofs after text, source, version or model evidence changes', () => {
    const u = draft()
    expect(bookProofMatches(u)).toBe(true)
    expect(bookProofMatches({ ...u, extraction: { ...extraction, passage: 'changed' } })).toBe(false)
    expect(bookProofMatches({ ...u, manifest: { ...u.manifest, pages: [3] } })).toBe(false)
    expect(bookProofMatches({ ...u, version: 2 })).toBe(false)
    expect(bookProofMatches({ ...u, verification: { ...u.verification, models: ['same', 'same'] } })).toBe(false)
  })
  it('requires all source tokens and detects invented English in automatic mode', () => {
    expect(validateBookUnit(manifest.units[0], extraction, true).errors).toEqual([])
    expect(validateBookUnit(manifest.units[0], { ...extraction, passage: extraction.passage + ' Invented sentence.' }, true).errors.join(' ')).toContain('없는 영어')
  })
  it('catches a lost Korean negation and swapped choices using the question-specific native block', () => {
    const stem = '다음 글의 내용과 일치하지 않는 것은?', native = { ...manifest.units[0], left_text: manifest.units[0].left_text.replace('발문', stem) }
    const q = { ...extraction.questions[0], stem: '다음 글의 내용과 일치하는 것은?' }
    expect(validateBookUnit(native, { ...extraction, questions: [q] }, true).errors.join(' ')).toContain('발문')
    expect(validateBookUnit(native, { ...extraction, questions: [{ ...q, stem, choices: [...q.choices].reverse() }] }, true).errors.join(' ')).toContain('선지 내용·순서')
  })
})
