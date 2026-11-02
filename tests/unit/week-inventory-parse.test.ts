import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedAnswer } from '@/lib/llm/week'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/lib/llm/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/llm/client')>(), callLlmTextDetailed: mocks.call,
}))

import { parseAnswerSheetDocument, normalizeParsedAnswers } from '@/lib/week-reading-import'
import { questionLabel } from '@/lib/question-presentation'

const files = [{ fileData: 'dGVzdA==', mimeType: 'image/png' }]
const inventory = {
  counts: { general: 1, written: 1 },
  questions: [
    { section: 'general', number: 1, sub_labels: [null], display_order: 1, passage_group: 'shared' },
    { section: 'written', number: 1, sub_labels: ['a', 'b'], display_order: 2, passage_group: 'shared' },
  ],
}
function answer(number: number, label: string | null): ParsedAnswer {
  return { question_number: number, sub_label: label, source_section: number === 1 ? 'general' : 'written',
    source_question_number: 1, question_style: number === 1 ? 'objective' : 'subjective',
    question_type: null, correct_answer: number === 1 ? 3 : 0, correct_answer_text: number === 1 ? null : '정답',
    grading_criteria: null, explanation: null, question_text: '문제 내용', question_stem: '발문', passage: '공통 지문', shared_passage: '공통 지문' }
}
function respond(value: unknown, stopReason = 'end_turn') {
  return { text: JSON.stringify(value), usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason }
}
function setup(written: (attempt: number) => ParsedAnswer[], stopReason = 'end_turn') {
  let attempts = 0
  mocks.call.mockImplementation(async ({ content }: { content: { text?: string }[] }) => {
    const instruction = content.at(-1)?.text ?? ''
    if (instruction.startsWith('문항 목록 조사:')) return respond(inventory)
    if (instruction.includes('question_number=2')) return respond(written(++attempts), stopReason)
    return respond([answer(1, null)])
  })
}

beforeEach(() => { mocks.call.mockReset() })

describe('week inventory extraction through document normalization (mocked LLM)', () => {
  it('keeps 6 → written 1(a,b) → 7 in PDF order with one shared passage and distinct grading keys', async () => {
    const layout = { counts: { general: 2, written: 1 }, questions: [
      { section: 'general', number: 6, sub_labels: [null], display_order: 1, passage_group: 'p6' },
      { section: 'written', number: 1, sub_labels: ['a', 'b'], display_order: 2, passage_group: 'p6' },
      { section: 'general', number: 7, sub_labels: [null], display_order: 3, passage_group: null },
    ] }
    mocks.call.mockImplementation(async ({ content }: { content: { text?: string }[] }) => {
      const instruction = content.at(-1)?.text ?? ''
      if (instruction.startsWith('문항 목록 조사:')) return respond(layout)
      const number = Number(instruction.match(/, question_number=(\d+)/)?.[1])
      const labels = number === 8 ? ['a', 'b'] : [null]
      return respond(labels.map((label) => ({ ...answer(number, label),
        source_section: number === 8 ? 'written' : 'general', source_question_number: number === 8 ? 1 : number })))
    })
    const result = await parseAnswerSheetDocument(files)
    expect(result.answers.map((q) => questionLabel(q))).toEqual(['6번', '서답형 1 (a)', '서답형 1 (b)', '7번'])
    expect(result.answers.map((q) => q.passage_group)).toEqual(['p6', 'p6', 'p6', null])
    expect(result.answers.map((q) => q.question_number)).toEqual([6, 8, 8, 7])
  })

  it('fills only omitted scope constants without rejecting otherwise complete legacy answers', async () => {
    setup(() => [answer(2, 'a'), answer(2, 'b')].map(q => ({ ...q, source_section: undefined, source_question_number: undefined })))
    const result = await parseAnswerSheetDocument(files)
    expect(result.answers[1]).toMatchObject({ source_section: 'written', source_question_number: 1, sub_label: 'a' })
  })
  it('preserves a grounded sparse find-error symbol instead of forcing the null inventory into subjective', async () => {
    mocks.call.mockImplementation(async ({ content }: { content: { text?: string }[] }) => {
      const instruction = content.at(-1)?.text ?? ''
      if (instruction.startsWith('문항 목록 조사:')) return respond({ counts: { general: 1, written: 0 }, questions: [
        { section: 'general', number: 2, sub_labels: [null], display_order: 1, passage_group: null },
      ] })
      return respond([{ ...answer(2, null), source_section: 'general', source_question_number: 2, question_style: 'find_error',
        correct_answer_text: 'b:struggle', answer_status: 'found', answer_evidence: { file_index: 1, page: 6, quote: '2. ② struggle' } }])
    })
    const result = await parseAnswerSheetDocument(files)
    expect(result.answers[0]).toMatchObject({ sub_label: 'b', question_style: 'find_error', correct_answer_text: 'b:struggle' })
    expect(mocks.call).toHaveBeenCalledTimes(2)
  })

  it('fails when no member can supply the shared source, rather than requiring redundant copies in every leaf', async () => {
    mocks.call.mockImplementation(async ({ content }: { content: { text?: string }[] }) => {
      const instruction = content.at(-1)?.text ?? ''
      if (instruction.startsWith('문항 목록 조사:')) return respond(inventory)
      if (instruction.startsWith('[공통 지문 확인]')) return respond({ shared_passage: null })
      return respond((instruction.includes('question_number=2') ? [answer(2, 'a'), answer(2, 'b')] : [answer(1, null)]).map(a => ({ ...a, shared_passage: null })))
    })
    await expect(parseAnswerSheetDocument(files)).rejects.toThrow('공통 지문 누락')
  })
  it('shares a single verified extraction across parents and siblings without losing any leaf', async () => {
    setup(() => [answer(2, 'a'), answer(2, 'b')].map(a => ({ ...a, shared_passage: null })))
    const result = await parseAnswerSheetDocument(files)
    expect(result.answers).toHaveLength(3)
    expect(result.answers.every(a => a.shared_passage === '공통 지문')).toBe(true)
    expect(mocks.call).toHaveBeenCalledTimes(3)
  })
  it('retries a missing sibling and preserves both sections and every leaf after normalization', async () => {
    setup((attempt) => attempt === 1 ? [answer(2, 'a')] : [answer(2, 'a'), answer(2, 'b')])
    const result = await parseAnswerSheetDocument(files)
    expect(result.answers.map((a) => [a.question_number, a.sub_label])).toEqual([[1, null], [2, 'a'], [2, 'b']])
    expect(result.answers[1].source_question_number).toBe(1)
    expect(result.answers[1].passage_group).toBe('shared')
    expect(result.answers[1].shared_passage).toBe('공통 지문')
    expect(result.answers[1].passage).toBe('공통 지문')
    expect(mocks.call).toHaveBeenCalledTimes(4)
  })

  it.each(['missing', 'duplicate', 'wrong-section', 'truncated'] as const)(
    'rejects %s after the bounded retry without using an unchecked whole-document fallback', async (failure) => {
      setup(() => failure === 'duplicate' ? [answer(2, 'a'), answer(2, 'a')] : failure === 'wrong-section'
        ? [answer(2, 'a'), { ...answer(2, 'b'), source_section: 'general' }] : [answer(2, 'a')],
      failure === 'truncated' ? 'max_tokens' : 'end_turn')
      await expect(parseAnswerSheetDocument(files)).rejects.toThrow('문항 누락 검증 실패')
      expect(mocks.call).toHaveBeenCalledTimes(4)
    },
  )

  it('rejects an invalid inventory after retry instead of falling back to seven partial questions', async () => {
    mocks.call.mockResolvedValue(respond({ ...inventory, counts: { general: 1, written: 3 } }))
    await expect(parseAnswerSheetDocument(files)).rejects.toThrow('문항 목록 검증 실패')
    expect(mocks.call).toHaveBeenCalledTimes(2)
  })

  it('does not collapse independently graded objective siblings that happen to share the correct answer', () => {
    const rows = ['b', 'c'].map((label) => ({ ...answer(1, label), inventory_sub_labels: ['b', 'c'] }))
    expect(normalizeParsedAnswers(rows).map((a) => a.sub_label)).toEqual(['b', 'c'])
  })
})


describe('strict contract for new exams only (mocked LLM)', () => {
  function setupCorrection(responses: ParsedAnswer[][]) {
    let attempts = 0
    mocks.call.mockImplementation(async ({ content }: { content: { text?: string }[] }) => {
      const instruction = content.at(-1)?.text ?? ''
      if (instruction.startsWith('문항 목록 조사:')) return respond({ counts: { general: 1, written: 0 }, questions: [
        { section: 'general', number: 2, sub_labels: [null], display_order: 1, passage_group: null },
      ] })
      return respond(responses[Math.min(attempts++, responses.length - 1)])
    })
  }
  const correction = (sub: string | null, key: string, style: ParsedAnswer['question_style'] = 'find_error'): ParsedAnswer => ({
    ...answer(2, sub), source_section: 'general', source_question_number: 2, shared_passage: null,
    question_text: '①~⑤ 중 틀린 것을 2개 찾아 번호를 쓰고 고치시오.', question_stem: null,
    question_style: style, correct_answer_text: key, answer_status: 'found',
    answer_evidence: { file_index: 1, page: 1, quote: '정답 ② asked ⑤ were' },
  })
  it('automatically re-extracts a misclassified merged response and repairs correction inventory coverage', async () => {
    setupCorrection([[correction(null, 'b:asked / e:were', 'subjective')], [correction('b', 'b:asked'), correction('e', 'e:were')]])
    const result = await parseAnswerSheetDocument(files, [], { validateAnswerContract: true })
    expect(result.answers.map(a => [a.question_style, a.sub_label, a.correct_answer_text])).toEqual([['find_error', 'b', 'b:asked'], ['find_error', 'e', 'e:were']])
    expect(mocks.call).toHaveBeenCalledTimes(3)
    expect(mocks.call.mock.calls[2][0].content.at(-1).text).toContain('find_error')
  })
  it('splits unnumbered word corrections without inventing a find-error symbol', async () => {
    const words = ['different → similar', 'undermine → reinforce'].map((key, i) => ({
      ...correction(i ? 'b' : 'a', key, 'subjective'), question_text: '문맥상 부적절한 단어 2개를 골라 쓰고 고치시오.',
    }))
    setupCorrection([words])
    const result = await parseAnswerSheetDocument(files, [], { validateAnswerContract: true })
    expect(result.answers.map(a => a.question_style)).toEqual(['subjective', 'subjective'])
    expect(result.answers.map(a => a.sub_label)).toEqual(['a', 'b'])
  })
  it('fails before returning persistable answers when retry still has the wrong shape', async () => {
    setupCorrection([[correction(null, 'b:asked / e:were', 'subjective')]])
    await expect(parseAnswerSheetDocument(files, [], { validateAnswerContract: true })).rejects.toThrow('문항 누락 검증 실패')
    expect(mocks.call).toHaveBeenCalledTimes(3)
  })
  it('does not apply the new strict contract to existing reparse callers', async () => {
    setupCorrection([[correction(null, 'b:asked / e:were', 'subjective')]])
    const result = await parseAnswerSheetDocument(files)
    expect(result.answers[0].question_style).toBe('subjective')
    expect(mocks.call).toHaveBeenCalledTimes(2)
  })
})
