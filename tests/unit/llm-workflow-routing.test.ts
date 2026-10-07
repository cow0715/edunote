import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ text: vi.fn(), detailed: vi.fn() }))
vi.mock('@/lib/llm/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/llm/client')>(),
  callLlmText: calls.text,
  callLlmTextDetailed: calls.detailed,
}))

import { createLlmExecution } from '@/lib/llm/client'
import { discoverQuestionNumbers, prewarmPdfCache, rangedParseCallIsolated } from '@/lib/llm/ranged'
import { gradeSubjectiveAnswers, type SubjectiveQuestion, type SubjectiveStudentAnswer } from '@/lib/llm/week'

const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 5 }
const files = [{ fileData: 'pdf-bytes', mimeType: 'application/pdf' }]
const detailed = (text: string) => ({ text, usage, stopReason: 'end_turn' })

beforeEach(() => { calls.text.mockReset(); calls.detailed.mockReset() })

describe('PDF routing and existing isolation', () => {
  it('shares a task binding and byte-identical cached prefix between prewarm and discovery', async () => {
    calls.detailed.mockResolvedValueOnce(detailed('')).mockResolvedValueOnce(detailed('[2,1,2]'))
    const execution = createLlmExecution({ 'week.parseAnswers': 'claude-sonnet-4-6' })
    await prewarmPdfCache({ files, task: 'week.parseAnswers', execution, prompt: 'shared prompt' })
    const result = await discoverQuestionNumbers({ files, task: 'week.parseAnswers', execution, prompt: 'shared prompt', label: 'test' })
    expect(result.numbers).toEqual([1, 2])
    const [warm, discovery] = calls.detailed.mock.calls.map(([options]) => options)
    expect(warm).toMatchObject({ task: 'week.parseAnswers', execution, phase: 'prewarm', maxTokens: 0, cacheBoundary: 1 })
    expect(discovery).toMatchObject({ task: 'week.parseAnswers', execution, maxTokens: 1000, cacheBoundary: 1 })
    expect(warm.content).toEqual(discovery.content.slice(0, 2))
    expect(warm.content[0]).toEqual({ type: 'pdf', data: 'pdf-bytes', mimeType: 'application/pdf' })
    expect(warm.content[1]).toEqual({ type: 'text', text: 'shared prompt' })
  })

  it('isolates refusal by question with the same execution and keeps successful scoped rows', async () => {
    calls.detailed.mockRejectedValueOnce(new Error('Output blocked by content filtering'))
      .mockResolvedValueOnce(detailed('[{"question_number":1},{"question_number":99}]'))
      .mockRejectedValueOnce(new Error('Output blocked by content filtering'))
    const execution = createLlmExecution()
    const result = await rangedParseCallIsolated({ files, task: 'examBank.extractExplanations', execution, maxTokens: 16000, prompt: 'prompt', scope: { numbers: [1, 2] }, label: 'test' })
    expect(result.items).toEqual([{ question_number: 1 }])
    expect(result.skippedNumbers).toEqual([2])
    expect(result.calls).toHaveLength(1)
    expect(calls.detailed.mock.calls.every(([options]) => options.execution === execution)).toBe(true)
    expect(calls.detailed.mock.calls.every(([options]) => options.task === 'examBank.extractExplanations')).toBe(true)
  })

  it('does not turn authentication failures into question isolation retries', async () => {
    calls.detailed.mockRejectedValueOnce(new Error('authentication failed'))
    await expect(rangedParseCallIsolated({ files, task: 'week.parseAnswers', maxTokens: 8192, prompt: 'prompt', scope: { numbers: [1, 2] }, label: 'test' })).rejects.toThrow('authentication failed')
    expect(calls.detailed).toHaveBeenCalledTimes(1)
  })
})

const questions: SubjectiveQuestion[] = [1, 2].map((number) => ({ question_number: number, sub_label: null, correct_answer_text: 'answer', grading_criteria: null }))
function answers(count: number): SubjectiveStudentAnswer[] {
  return Array.from({ length: count }, (_, index) => ({
    week_score_id: `score-${index}`, exam_question_id: index % 2 ? 'q2' : 'q1',
    question_number: index % 2 ? 2 : 1, sub_label: null, student_name: `student-${index}`, student_answer_text: 'answer',
  }))
}

describe('subjective grading routing', () => {
  it('uses one production batch at the 30-answer threshold and marks omitted answers for review', async () => {
    calls.text.mockResolvedValue('[{"idx":0,"is_correct":true,"confidence":"high","feedback":""}]')
    const execution = createLlmExecution({ 'week.gradeSubjective': 'claude-opus-5' })
    const result = await gradeSubjectiveAnswers(questions, answers(30), { execution })
    expect(calls.text).toHaveBeenCalledTimes(1)
    expect(calls.text.mock.calls[0][0]).toMatchObject({ task: 'week.gradeSubjective', execution, maxTokens: 4096, temperature: 0 })
    expect(result).toHaveLength(30)
    expect(result[0]).toMatchObject({ is_correct: true, needs_review: false })
    expect(result.filter((row) => row.needs_review)).toHaveLength(29)
  })

  it('splits 31 answers by main question and preserves partial failure with one shared execution', async () => {
    calls.text.mockResolvedValueOnce('[{"idx":0,"is_correct":true,"confidence":"high","feedback":""}]')
      .mockRejectedValueOnce(new Error('rate limited'))
    const execution = createLlmExecution()
    const result = await gradeSubjectiveAnswers(questions, answers(31), { execution })
    expect(calls.text).toHaveBeenCalledTimes(2)
    expect(calls.text.mock.calls.every(([options]) => options.execution === execution)).toBe(true)
    expect(result).toHaveLength(31)
    expect(result.filter((row) => row.is_correct)).toHaveLength(1)
    expect(result.filter((row) => row.needs_review)).toHaveLength(30)
    expect(result.filter((row) => row.ai_feedback.includes('실패'))).toHaveLength(15)
  })
})
