import { beforeEach, describe, expect, it, vi } from 'vitest'
import sungmun from '../fixtures/sungmun-week4.golden.json'
import testweek from '../fixtures/testweek4.golden.json'
import week8 from '../fixtures/week8-1.golden.json'
import yeyeol from '../fixtures/yeyeol-test-0322.golden.json'
import type { ParsedAnswer } from '@/lib/llm/week'
import { PARSE_ANSWER_SHEET_RULES, buildExamOcrVisionPrompt } from '@/lib/prompts'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/lib/llm/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/llm/client')>(), callLlmTextDetailed: mocks.call,
}))
import { parseAnswerSheetDocument } from '@/lib/week-reading-import'

type Contract = Pick<ParsedAnswer, 'question_number' | 'sub_label' | 'question_style' | 'correct_answer' | 'correct_answer_text'>
type Baseline = Contract & { question_type?: string | null; choices?: string[] | null }
const files = [{ fileData: 'bW9ja2VkIGRvY3VtZW50', mimeType: 'image/png' }]
const response = (value: unknown) => ({ text: JSON.stringify(value), stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
const contract = (q: Contract): Contract => ({ question_number: q.question_number, sub_label: q.sub_label,
  question_style: q.question_style, correct_answer: q.correct_answer, correct_answer_text: q.correct_answer_text })

// These are recorded answer contracts, not a substitute for rereading the source
// PDFs with a real model. Replay model responses through the production pipeline
// to detect numbering, style, normalization and coverage regressions without fees.
function replay(rows: Baseline[], omitLeaf?: { number: number; label: string }) {
  const groups = [...new Set(rows.map(q => q.question_number))].map((number, i) => ({
    section: 'general', number, sub_labels: rows.filter(q => q.question_number === number).map(q => q.sub_label),
    display_order: i + 1, passage_group: null,
  }))
  mocks.call.mockImplementation(async ({ content }: { content: { text?: string }[] }) => {
    expect(content.at(-2)?.text).toContain(PARSE_ANSWER_SHEET_RULES)
    const instruction = content.at(-1)?.text ?? ''
    if (instruction.startsWith('문항 목록 조사:')) return response({ counts: { general: groups.length, written: 0 }, questions: groups })
    const number = Number(instruction.match(/, question_number=(\d+)/)?.[1])
    return response(rows.filter(q => q.question_number === number && !(omitLeaf?.number === number && omitLeaf.label === q.sub_label)).map(q => ({
      ...q, source_section: 'general', source_question_number: number,
      grading_criteria: null, explanation: '기준 해설', question_text: '기준 발문', question_stem: '기준 발문', passage: null,
    })))
  })
}

beforeEach(() => { mocks.call.mockReset() })

describe('legacy PDF answer contracts through current inventory pipeline (mocked LLM)', () => {
  it.each([
    ['sungmun-week4', sungmun, 17], ['testweek4', testweek, 28], ['week8-1', week8, 25], ['yeyeol-test-0322', yeyeol, 6],
  ] as const)('preserves every recorded grading key and answer in %s (recorded rows)', async (_name, golden, count) => {
    const rows = golden as Baseline[]
    replay(rows)
    const result = await parseAnswerSheetDocument(files)
    expect(result.answers).toHaveLength(count)
    expect(result.answers.map(contract)).toEqual(rows.map(contract))
    expect(result.answers.every(q => q.source_section === 'general' && q.source_question_number === q.question_number)).toBe(true)
    expect(result.skipped).toEqual([])
    for (const row of rows) {
      expect(result.answers.find(q => q.question_number === row.question_number && q.sub_label === row.sub_label)?.choices).toEqual(row.choices ?? null)
    }
  })

  const styles: Baseline[] = [
    { question_number: 1, sub_label: null, question_style: 'objective', correct_answer: 4, correct_answer_text: null, choices: ['(A) a (B) b', '(A) c (B) d', '(A) e (B) f', '(A) g (B) h', '(A) i (B) j'] },
    { question_number: 2, sub_label: null, question_style: 'multi_select', correct_answer: 0, correct_answer_text: '1,3' },
    { question_number: 3, sub_label: 'a', question_style: 'ox', correct_answer: 0, correct_answer_text: 'O' },
    { question_number: 3, sub_label: 'b', question_style: 'ox', correct_answer: 0, correct_answer_text: 'X (has)' },
    { question_number: 4, sub_label: 'a', question_style: 'ox', correct_answer: 0, correct_answer_text: 'T' },
    { question_number: 4, sub_label: 'b', question_style: 'ox', correct_answer: 0, correct_answer_text: 'F' },
    { question_number: 5, sub_label: 'c', question_style: 'find_error', correct_answer: 0, correct_answer_text: 'c:asked' },
    { question_number: 5, sub_label: 'e', question_style: 'find_error', correct_answer: 0, correct_answer_text: 'e:watching' },
    { question_number: 6, sub_label: 'a', question_style: 'subjective', correct_answer: 0, correct_answer_text: 'enough' },
    { question_number: 6, sub_label: 'b', question_style: 'subjective', correct_answer: 0, correct_answer_text: 'greenhouse' },
  ]
  it('retains combination choices, multi-select, OX, TF, sparse find-error labels and unprefixed subjective siblings', async () => {
    replay(styles)
    expect((await parseAnswerSheetDocument(files)).answers.map(contract)).toEqual(styles.map(contract))
  })
  it('rejects a missing sibling in legacy documents too, rather than silently accepting a partial import', async () => {
    replay(styles, { number: 6, label: 'b' })
    await expect(parseAnswerSheetDocument(files)).rejects.toThrow('일반 6(b): 누락')
  })
  it('still describes legacy answer sheets that have no source numbering metadata', () => {
    const prompt = buildExamOcrVisionPrompt(styles.map(q => ({ ...q, ox_notation: q.question_number === 4 ? 'TF' : 'OX' })))
    expect(prompt).toContain('- 1번: 객관식 (1~5 중 선택)')
    expect(prompt).toContain('- 4번 (a): T/F 판단형')
    expect(prompt).toContain('- 5번 (c): 오류교정 (기호+고친 표현)')
    expect(prompt).toContain('- 6번 (b): 서술형')
  })
})
