import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallLlmOptions, LlmDetailedResult } from '@/lib/llm/types'
import type { PdfImportJob } from '@/lib/pdf-import/types'
import { createCallLimiter, withPdfWorkerContext, type PdfWorkerContext } from '@/lib/pdf-import/context'
import { PdfBatchPending } from '@/lib/pdf-import/batch-policy'

const mocks = vi.hoisted(() => ({ stats: vi.fn(), sync: vi.fn(), download: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() { throw Error('Unexpected synchronous/paid API call') } } }))
vi.mock('@/lib/megastudy', () => ({ getMegastudyStats: mocks.stats }))
vi.mock('@/lib/exam-vocabulary', () => ({ mergeExamVocabularyText: (_a: unknown, text: string) => text, syncExamQuestionVocabulary: mocks.sync }))
vi.mock('@/lib/week-reading-import', () => ({}))
vi.mock('@/lib/pdf-import/server', () => ({ weekImportSnapshot: vi.fn() }))
import { runPdfImport } from '@/lib/pdf-import/handlers'

const words = Array.from({ length: 28 }, (_, i) => ['a', 'b', 'c'].map((suffix) => `word${i + 18}${suffix}`)).flat()
function fixture(month = 11, explanationOnly = false) {
  const questions = new Map<number, Record<string, unknown>>()
  let exam = { id: 'exam', exam_month: month }, questionWrites = 0, explanationWrites = 0
  if (explanationOnly) for (let n = 18; n <= 45; n++) questions.set(n, { id: `q-${n}`, question_number: n, passage: `Passage ${n}`, question_type: 'purpose' })
  const db = {
    storage: { from: () => ({ download: mocks.download }) },
    from(table: string) {
      let update: Record<string, unknown> | null = null
      const filters = new Map<string, unknown>()
      const query = {
        select: () => query, order: () => query, limit: () => query, in: () => query,
        eq: (key: string, value: unknown) => { filters.set(key, value); return query },
        single: async () => ({ data: table === 'teacher' ? { id: 'teacher' } : exam, error: null }),
        upsert: async (value: Record<string, unknown> | Record<string, unknown>[]) => {
          if (table === 'exam_bank') exam = { ...exam, ...value }
          else if (Array.isArray(value)) { questionWrites++; for (const q of value) questions.set(Number(q.question_number), { ...q, id: `q-${q.question_number}` }) }
          return { error: null }
        },
        update: (value: Record<string, unknown>) => { update = value; return query },
        then: (resolve: (value: unknown) => unknown) => {
          if (table === 'exam_bank_question' && update) {
            const q = filters.has('id') ? [...questions.values()].find((q) => q.id === filters.get('id')) : questions.get(Number(filters.get('question_number')))
            if (q) Object.assign(q, update)
            if ('explanation_solution' in update) explanationWrites++
          }
          const data = table === 'exam_bank_question' ? [...questions.values()] : update ? [{ id: 'vocab' }]
            : words.map((word) => ({ id: word, normalized_word: word, word, meaning: '뜻', topic: '어휘', synonyms: [], antonyms: [], similar_words: [] }))
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    },
  } as unknown as SupabaseClient
  const saved = new Map<string, unknown>(), pending = new Map<string, CallLlmOptions>(), deliveries = new Map<string, LlmDetailedResult>()
  const context: PdfWorkerContext = { signal: new AbortController().signal, concurrency: 2, execute: createCallLimiter(2), stage: async () => {},
    read: async <T>(key: string) => (saved.get(key) ?? null) as T | null, write: async (key, value) => { saved.set(key, value) },
    batchCall: async (options, key) => {
      if (deliveries.has(key)) return deliveries.get(key)!
      pending.set(key, options); throw new PdfBatchPending()
    },
  }
  const job: PdfImportJob = { id: 'job', target_id: 'exam', teacher_id: 'teacher', kind: explanationOnly ? 'bank_explanation' : 'bank_questions',
    status: 'running', stage: 'test', completed_calls: 0, attempt: 1, lease_token: 'lease', lease_expires_at: null, result: null, error: null, created_at: '', updated_at: '',
    source_path: explanationOnly ? 'explanation.pdf' : 'questions.pdf', payload: { batchProcessing: 'batch-v1', title: '시험', exam_month: month,
      exam_year: 2026, grade: 3, source: month === 11 ? '수능' : '모의고사', ...(explanationOnly ? {} : { explanationSourcePath: 'explanation.pdf' }) } }
  const run = () => withPdfWorkerContext(context, () => runPdfImport(db, job))
  function deliver() {
    for (const [key, options] of pending) {
      const content = options.content
      const n = typeof content === 'string' ? 0 : Number((content.at(-1) as { text: string }).text.match(/출력하세요: (\d+)번/)![1])
      const value = options.task === 'examBank.parseQuestions'
        ? [{ question_number: n, question_type: 'purpose', passage: `Passage ${n}`, question_text: `Question ${n}`, choices: ['① one', '② two'], answer: '①' }]
        : options.task === 'examBank.extractExplanations'
          ? [{ question_number: n, intent: `의도 ${n}`, translation: `원문 해석 ${n}`, solution: `보완 풀이 ${n}`, vocabulary: `word${n}a 뜻` }]
          : (JSON.parse((content as string).match(/입력:\n([\s\S]*?)\n\n출력 형식:/)![1]) as { normalized_word: string }[])
            .map((word) => ({ normalized_word: word.normalized_word, topic: '어휘', synonyms: ['term'], antonyms: [], similar_words: [] }))
      deliveries.set(key, { text: JSON.stringify(value), finishReason: 'complete', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, execution: {
        executionId: 'test', task: options.task, provider: 'anthropic', requestedModel: options.execution!.taskBindings[options.task], responseModel: 'test',
        configVersion: 'test', durationMs: 0, phase: 'generate', promptHash: 'test', promptVersion: 'test', schemaVersion: 'test', sdkRetryCount: 0,
      } })
    }
    pending.clear()
  }
  return { run, pending, deliver, questions, deliveries, writes: () => ({ questionWrites, explanationWrites }) }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ANTHROPIC_API_KEY', 'mock-only')
  mocks.download.mockImplementation(async (path: string) => ({ data: new Blob([path === 'questions.pdf' ? 'question source' : 'separate explanation source']), error: null }))
  mocks.stats.mockResolvedValue([{ question_number: 18, answer: '③', difficulty: '하', points: 2, correct_rate: 90, choice_rates: [5, 5, 90, 0, 0] }])
  mocks.sync.mockImplementation(async (_db, id: string) => ({ normalizedWords: ['a', 'b', 'c'].map((s) => `word${id.slice(2)}${s}`) }))
})
afterEach(() => vi.unstubAllEnvs())

describe('exam import across durable Batch wakeups, with real parsers and mocked provider deliveries', () => {
  it.each([[11, 'standard'], [6, 'standard'], [3, 'hakpyung']] as const)('keeps separate PDFs and existing writing rules for month %i', async (month, mode) => {
    const f = fixture(month)
    await expect(f.run()).rejects.toBeInstanceOf(PdfBatchPending)
    expect(f.pending.size).toBe(28)
    for (const options of f.pending.values()) {
      expect(options.task).toBe('examBank.parseQuestions'); expect(options.maxTokens).toBe(8192)
      expect(options.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'pdf', data: Buffer.from('question source').toString('base64') })]))
    }
    f.deliver(); await expect(f.run()).rejects.toBeInstanceOf(PdfBatchPending)
    expect(f.pending.size).toBe(28)
    for (const options of f.pending.values()) {
      expect(options.task).toBe('examBank.extractExplanations'); expect(options.maxTokens).toBe(16000)
      expect(options.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'pdf', data: Buffer.from('separate explanation source').toString('base64') })]))
      expect(JSON.stringify(options.content)).toContain('원문')
      expect(JSON.stringify(options.content)).toContain('풀이')
    }
    f.deliver(); await expect(f.run()).rejects.toBeInstanceOf(PdfBatchPending)
    expect(f.pending.size).toBe(3) // All 84 word candidates / 40 are collected in one wave.
    for (const options of f.pending.values()) expect(options.task).toBe('vocab.enrich')
    const writes = f.writes(); f.deliver()
    const result = await f.run()
    expect(result).toMatchObject({ question_count: 28, stats_fetched: 1, explanation_result: { updated: 28, mode, enriched: { generated: 84 } } })
    expect(f.writes()).toEqual(writes); expect(writes).toEqual({ questionWrites: 1, explanationWrites: 28 })
    expect(mocks.stats).toHaveBeenCalledTimes(1)
    expect(f.questions.get(18)).toMatchObject({ passage: 'Passage 18', answer: '③', explanation_translation: '원문 해석 18', explanation_solution: '보완 풀이 18' })
    expect(f.deliveries.size).toBe(59) // 28+28+3, no prewarm requests or synchronous SDK calls.
    expect(f.pending.size).toBe(0)
  })
  it('supports a later explanation-only upload without reparsing or rewriting the existing questions', async () => {
    const f = fixture(11, true)
    await expect(f.run()).rejects.toBeInstanceOf(PdfBatchPending)
    expect(f.pending.size).toBe(28)
    expect([...f.pending.values()].every((o) => o.task === 'examBank.extractExplanations')).toBe(true)
    f.deliver(); await expect(f.run()).rejects.toBeInstanceOf(PdfBatchPending)
    f.deliver(); expect(await f.run()).toMatchObject({ updated: 28, enriched: { generated: 84 } })
    expect(f.writes().questionWrites).toBe(0)
    expect(mocks.stats).not.toHaveBeenCalled()
    expect(mocks.download.mock.calls.every(([path]) => path === 'explanation.pdf')).toBe(true)
  })
})
