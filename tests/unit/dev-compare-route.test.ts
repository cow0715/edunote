import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/dev/compare/route'
import { estimateLlmCost } from '@/lib/llm/models'
import { getDefaultTaskBindings } from '@/lib/llm/tasks'
import type { LlmExecution, LlmCallRecord, LlmUsage } from '@/lib/llm/types'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), grade: vi.fn(), exam: vi.fn(), vocabPdf: vi.fn(), answers: vi.fn(),
  teacherId: vi.fn(), tags: vi.fn(),
  from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  getAuth: mocks.auth,
  getTeacherId: mocks.teacherId,
  err: (error: string, status = 400) => Response.json({ error }, { status }),
  ok: (value: unknown) => Response.json(value),
}))
vi.mock('@/lib/llm/vocab', () => ({ gradeVocabItemsDetailed: mocks.grade, parseVocabPdf: mocks.vocabPdf }))
vi.mock('@/lib/llm/exam-bank', () => ({ parseExamBankPageRanged: mocks.exam }))
vi.mock('@/lib/week-reading-import', () => ({ parseAnswerSheetDocument: mocks.answers, fetchTeacherTagContext: mocks.tags }))

const haiku = 'claude-haiku-4-5-20251001'
const sonnet = 'claude-sonnet-5'
const items = [
  { number: 0, english_word: 'run', student_answer: '운영하다', correct_answer: '달리다' },
  { number: 0, english_word: 'fine', student_answer: '벌금', correct_answer: '좋은' },
]
const usage: LlmUsage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 1000, cacheWriteTokens: 100 }

function record(execution: LlmExecution, changes: Partial<LlmCallRecord> = {}): LlmCallRecord {
  return {
    executionId: execution.id, task: 'vocab.gradeMeaning', provider: 'anthropic',
    requestedModel: execution.taskBindings['vocab.gradeMeaning'], responseModel: haiku,
    configVersion: execution.configVersion, durationMs: 20, phase: 'generate',
    promptHash: 'prompt-hash', promptVersion: 'legacy-v1', schemaVersion: 'legacy-v1',
    sdkRetryCount: null, usage, stopReason: 'end_turn', finishReason: 'complete', errorKind: null,
    ...changes,
  }
}

function request(body: unknown) {
  return new Request('http://local/api/dev/compare', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle }
  mocks.from.mockReturnValue(query)
  mocks.select.mockReturnValue(query)
  mocks.eq.mockReturnValue(query)
  mocks.maybeSingle.mockResolvedValue({ data: { content: '저장된 교사 채점 규칙' } })
  mocks.auth.mockResolvedValue({ user: { id: 'teacher' }, supabase: { from: mocks.from } })
  mocks.teacherId.mockResolvedValue('teacher-record')
  mocks.tags.mockResolvedValue({ tagList: [], tagCategories: [] })
  mocks.grade.mockImplementation(async (input, _rules, { execution }: { execution: LlmExecution }) => {
    execution.calls.push(record(execution))
    return { results: input.map((item: { number: number }) => ({ ...item, is_correct: true })) }
  })
  mocks.answers.mockResolvedValue({ answers: [{ question_number: 1 }] })
  mocks.exam.mockResolvedValue({ items: [{ question_number: 18 }] })
  mocks.vocabPdf.mockResolvedValue([{ number: 1, english_word: 'run' }])
})

describe('dev comparison uses production domain functions without saving results', () => {
  it('rejects unauthenticated requests before running models or reading prompts', async () => {
    mocks.auth.mockResolvedValue({ user: null })
    expect((await POST(request({ fn: 'gradeVocabItems', model: haiku, jsonInput: items }))).status).toBe(401)
    expect(mocks.grade).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects unregistered model IDs before the production function is called', async () => {
    expect((await POST(request({ fn: 'gradeVocabItems', model: 'latest-model', jsonInput: items }))).status).toBe(400)
    expect(mocks.grade).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('reads the same saved rules and passes duplicate retake numbers in their original order', async () => {
    const response = await POST(request({ fn: 'gradeVocabItems', model: haiku, jsonInput: JSON.stringify(items) }))
    const body = await response.json()
    expect(mocks.grade).toHaveBeenCalledWith(items, '저장된 교사 채점 규칙', { execution: expect.any(Object) })
    expect(mocks.from).toHaveBeenCalledOnce()
    expect(mocks.from).toHaveBeenCalledWith('prompts')
    expect(mocks.select).toHaveBeenCalledWith('content')
    expect(mocks.eq).toHaveBeenCalledWith('key', 'vocab_grading_rules')
    expect(body.gradingRulesHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.result.map((item: { english_word: string }) => item.english_word)).toEqual(['run', 'fine'])
    expect(body.inputTokens).toBe(1000)
    expect(body.cacheReadTokens).toBe(1000)
    expect(body.cost).toBeCloseTo(estimateLlmCost(haiku, usage)!)
  })

  it('keeps a comparison override within each request and leaves other task defaults intact', async () => {
    const baseline = getDefaultTaskBindings()
    await Promise.all([
      POST(request({ fn: 'gradeVocabItems', model: sonnet, jsonInput: items, customRules: '' })),
      POST(request({ fn: 'gradeVocabItems', model: haiku, jsonInput: items, customRules: '' })),
    ])
    const executions = mocks.grade.mock.calls.map((call) => call[2].execution as LlmExecution)
    expect(executions.map((execution) => execution.taskBindings['vocab.gradeMeaning'])).toEqual([sonnet, haiku])
    expect(executions[0].id).not.toBe(executions[1].id)
    for (const execution of executions) {
      expect(execution.taskBindings['vocab.answerOcr']).toBe(baseline['vocab.answerOcr'])
      expect(execution.calls).toHaveLength(1)
      expect(Object.isFrozen(execution.taskBindings)).toBe(true)
    }
    expect(getDefaultTaskBindings()).toEqual(baseline)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('runs the full answer-sheet parsing entrypoint and sums every call including cache prewarm', async () => {
    mocks.answers.mockImplementation(async (_files, _tags, { execution }: { execution: LlmExecution }) => {
      const properties = { task: 'week.parseAnswers' as const, requestedModel: sonnet }
      execution.calls.push(record(execution, { ...properties, phase: 'prewarm', usage: { ...usage, outputTokens: 0 } }))
      execution.calls.push(record(execution, properties))
      return { answers: [{ question_number: 1 }] }
    })
    const body = await (await POST(request({ fn: 'parseAnswerSheet', model: sonnet, fileData: 'pdf-base64', mimeType: 'application/pdf' }))).json()
    expect(mocks.answers).toHaveBeenCalledWith([{ fileData: 'pdf-base64', mimeType: 'application/pdf' }], [], { execution: expect.any(Object) })
    expect(body.result).toEqual([{ question_number: 1 }])
    expect(body.inputTokens).toBe(2000)
    expect(body.outputTokens).toBe(100)
    expect(body.cacheWriteTokens).toBe(200)
    expect(body.calls).toHaveLength(2)
    expect(body.cost).toBeCloseTo(estimateLlmCost(sonnet, usage)! + estimateLlmCost(sonnet, { ...usage, outputTokens: 0 })!)
  })

  it('routes exam-bank and vocabulary files through their production parsing functions', async () => {
    for (const fn of ['parseExamBankPage', 'parseVocabPdf']) {
      const response = await POST(request({ fn, model: sonnet, fileData: 'image-base64', mimeType: 'image/png' }))
      expect(response.status).toBe(200)
    }
    expect(mocks.exam).toHaveBeenCalledWith('image-base64', 'image/png', { execution: expect.any(Object) })
    expect(mocks.vocabPdf).toHaveBeenCalledWith('image-base64', 'image/png', { execution: expect.any(Object) })
    expect(mocks.grade).not.toHaveBeenCalled()
  })

  it('reuses the teacher\'s stored type categories in the production answer-sheet prompt', async () => {
    const tagCategories = [{ categoryName: '문법', tags: ['관계사', '가정법'] }]
    mocks.tags.mockResolvedValue({ tagList: [], tagCategories })
    await POST(request({ fn: 'parseAnswerSheet', model: sonnet, fileData: 'pdf-base64', mimeType: 'application/pdf' }))
    expect(mocks.teacherId).toHaveBeenCalledWith({ from: mocks.from }, 'teacher')
    expect(mocks.tags).toHaveBeenCalledWith({ from: mocks.from }, 'teacher-record')
    expect(mocks.answers).toHaveBeenCalledWith([{ fileData: 'pdf-base64', mimeType: 'application/pdf' }], tagCategories, { execution: expect.any(Object) })
    expect(mocks.grade).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('retains known failed-call usage and cost when the model response is refused', async () => {
    mocks.grade.mockImplementation(async (_input, _rules, { execution }: { execution: LlmExecution }) => {
      execution.calls.push(record(execution, { errorKind: 'refusal', finishReason: 'refusal' }))
      throw new Error('Output blocked by content filtering (refusal)')
    })
    const body = await (await POST(request({ fn: 'gradeVocabItems', model: haiku, jsonInput: items }))).json()
    expect(body.error).toContain('refusal')
    expect(body.inputTokens).toBe(1000)
    expect(body.cost).toBeCloseTo(estimateLlmCost(haiku, usage)!)
  })

  it('represents missing failure usage as unknown rather than zero cost', async () => {
    mocks.grade.mockImplementation(async (_input, _rules, { execution }: { execution: LlmExecution }) => {
      execution.calls.push(record(execution, { usage: null, errorKind: 'network', finishReason: null }))
      throw new Error('network failure')
    })
    const body = await (await POST(request({ fn: 'gradeVocabItems', model: haiku, jsonInput: items }))).json()
    expect(body.inputTokens).toBeNull()
    expect(body.outputTokens).toBeNull()
    expect(body.cost).toBeNull()
  })
})
