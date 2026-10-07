import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmDetailedResult } from '@/lib/llm/types'
import type { ParsedVocabEntry } from '@/lib/vocab-xlsx'

const mocks = vi.hoisted(() => ({
  detailed: vi.fn(),
  text: vi.fn(),
  configured: vi.fn(),
}))

vi.mock('@/lib/llm/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/client')>()
  return {
    ...actual,
    callLlmTextDetailed: mocks.detailed,
    callLlmText: mocks.text,
    isTaskConfigured: mocks.configured,
  }
})

import { buildFileBlock, createLlmExecution } from '@/lib/llm/client'
import { gradeVocabItems, gradeVocabItemsDetailed, gradeVocabPhoto, parseVocabPdf, readVocabSheetName } from '@/lib/llm/vocab'
import { generateSmsMessages, refineSmsTemplateMessage } from '@/lib/llm/sms'
import { generateVariantMeanings, normalizeVocabEntries } from '@/lib/vocab-variants'
import { buildVocabGradingPrompt, buildVocabOcrVisionPrompt, VOCAB_PDF_PROMPT } from '@/lib/prompts'

function response(text: string, stopReason = 'end_turn'): LlmDetailedResult {
  return {
    text,
    stopReason,
    finishReason: stopReason === 'max_tokens' ? 'length' : 'complete',
    usage: { inputTokens: 100, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 },
    execution: {
      executionId: 'test-run',
      task: 'vocab.gradeMeaning',
      provider: 'anthropic',
      requestedModel: 'claude-haiku-4-5-20251001',
      responseModel: 'claude-haiku-4-5-20251001',
      configVersion: 'test',
      durationMs: 5,
      phase: 'generate',
      promptHash: 'test-prompt',
      promptVersion: '1',
      schemaVersion: '1',
      sdkRetryCount: null,
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.configured.mockReturnValue(true)
  mocks.text.mockResolvedValue('[]')
  mocks.detailed.mockResolvedValue(response('[]'))
  vi.stubEnv('CLOVA_OCR_API_URL', '')
  vi.stubEnv('CLOVA_OCR_SECRET', '')
})

afterEach(() => vi.unstubAllEnvs())

describe('vocabulary grading task routing', () => {
  it('runs the production prompt and budget while preserving duplicate retake numbers and metrics', async () => {
    const items = [
      { number: 0, english_word: 'run', student_answer: ' 운영하다 ', correct_answer: '달리다' },
      { number: 0, english_word: 'borrow', student_answer: '빌려주다', correct_answer: '빌리다' },
    ]
    const grades = [
      { number: 0, english_word: 'run', student_answer: '운영하다', is_correct: true },
      { number: 0, english_word: 'borrow', student_answer: '빌려주다', is_correct: false },
    ]
    const raw = response(JSON.stringify(grades))
    mocks.detailed.mockResolvedValue(raw)
    const execution = createLlmExecution({ 'vocab.gradeMeaning': 'claude-sonnet-4-6' })

    const detailed = await gradeVocabItemsDetailed(items, '맞춤 채점 규칙', { execution })
    expect(detailed).toEqual({ ...raw, results: grades })
    expect(mocks.detailed).toHaveBeenCalledExactlyOnceWith({
      task: 'vocab.gradeMeaning',
      execution,
      maxTokens: 8192,
      content: buildVocabGradingPrompt(items, '맞춤 채점 규칙'),
    })
    expect(await gradeVocabItems(items, '맞춤 채점 규칙', { execution })).toEqual(grades)
  })

  it('keeps registered legacy model overrides scoped to meaning grading', async () => {
    await gradeVocabItems([], undefined, 'claude-sonnet-4-6')
    const call = mocks.detailed.mock.calls[0][0]
    expect(call.task).toBe('vocab.gradeMeaning')
    expect(call.execution.taskBindings['vocab.gradeMeaning']).toBe('claude-sonnet-4-6')
    expect(call.execution.taskBindings['vocab.answerOcr']).toBe('claude-sonnet-5')
  })

  it('rejects truncated grading output rather than accepting repaired partial rows', async () => {
    mocks.detailed.mockResolvedValue(response('[{"number":1}]', 'max_tokens'))
    await expect(gradeVocabItems([])).rejects.toThrow('채점 응답이 길이 제한에 잘렸습니다')
  })

  it('shares one execution between photo OCR and meaning grading while retaining code-graded rows', async () => {
    const ocr = [
      { number: 3, english_word: 'includes', student_answer: 'includes' },
      { number: 2, english_word: 'run', student_answer: '운영하다' },
      { number: 1, english_word: 'abandoned', student_answer: 'abandomed' },
    ]
    const meaning = { number: 2, english_word: 'run', student_answer: '운영하다', is_correct: true }
    mocks.detailed.mockResolvedValueOnce(response(JSON.stringify(ocr))).mockResolvedValueOnce(response(JSON.stringify([meaning])))
    const exampleItems = [
      { number: 1, printed_sentence: 'They ___ the plan.', kind: 'blank' as const },
      { number: 3, printed_sentence: 'It [ includes / excludes ] lunch.', kind: 'choice' as const },
    ]
    const expectedItems = [{ number: 2, word: 'run' }]

    const grades = await gradeVocabPhoto('photo-data', 'image/png', {
      correctAnswers: new Map([[1, 'abandoned'], [2, '달리다'], [3, 'includes']]),
      exampleItems,
      expectedItems,
      customRules: '사전적 뜻 중 하나를 인정',
    })

    const ocrCall = mocks.detailed.mock.calls[0][0]
    const gradingCall = mocks.detailed.mock.calls[1][0]
    expect(ocrCall).toEqual({
      task: 'vocab.answerOcr',
      execution: ocrCall.execution,
      maxTokens: 8192,
      content: [buildFileBlock('photo-data', 'image/png'), { type: 'text', text: buildVocabOcrVisionPrompt(exampleItems, expectedItems) }],
    })
    expect(gradingCall.execution).toBe(ocrCall.execution)
    expect(ocrCall.execution.taskBindings['vocab.answerOcr']).toBe('claude-sonnet-5')
    expect(gradingCall.execution.taskBindings['vocab.gradeMeaning']).toBe('claude-haiku-4-5-20251001')
    expect(gradingCall.content).toBe(buildVocabGradingPrompt([{ ...ocr[1], correct_answer: '달리다' }], '사전적 뜻 중 하나를 인정'))
    expect(grades).toEqual([
      { ...ocr[2], is_correct: true },
      meaning,
      { ...ocr[0], is_correct: true },
    ])
  })

  it('rejects truncated OCR before starting grading', async () => {
    mocks.detailed.mockResolvedValue(response('[]', 'max_tokens'))
    await expect(gradeVocabPhoto('photo-data', 'image/png')).rejects.toThrow('OCR 응답이 길이 제한에 잘렸습니다')
    expect(mocks.detailed).toHaveBeenCalledTimes(1)
  })

  it('retains the PDF prompt and the name matcher rules under distinct tasks', async () => {
    const execution = createLlmExecution()
    await parseVocabPdf('pdf-data', 'application/pdf', { execution })
    expect(mocks.text).toHaveBeenLastCalledWith({
      task: 'vocab.parsePdf', execution, maxTokens: 4096,
      content: [buildFileBlock('pdf-data', 'application/pdf'), { type: 'text', text: VOCAB_PDF_PROMPT }],
    })
    mocks.text.mockResolvedValue('{"rawName":"김테스트","name":"홍길동"}')
    expect(await readVocabSheetName('photo-data', 'image/png', ['홍길동'], { execution })).toEqual({ name: null, rawName: '김테스트', confidence: 'none' })
    expect(mocks.text.mock.calls[1][0]).toMatchObject({ task: 'vocab.sheetName', execution, maxTokens: 120 })
  })
})

describe('SMS task routing', () => {
  it('retains refinement cleanup and avoids calling a model for an empty student batch', async () => {
    const execution = createLlmExecution()
    mocks.text.mockResolvedValue('```text\n◆ 첫 문장\n둘째 문장\n```')
    expect(await refineSmsTemplateMessage('원문', '문자 규칙', { execution })).toBe('첫 문장 둘째 문장')
    expect(mocks.text.mock.calls[0][0]).toMatchObject({ task: 'sms.write', execution, maxTokens: 1024 })
    expect(await generateSmsMessages({ week_number: 1, class_name: '테스트반' }, [], undefined, { execution })).toEqual([])
    expect(mocks.text).toHaveBeenCalledTimes(1)
  })
})

describe('optional vocabulary enrichment', () => {
  const entry: ParsedVocabEntry = {
    number: 1, passage_label: null, english_word: 'run', part_of_speech: 'v.',
    correct_answer: '달리다', synonyms: [], antonyms: [], derivatives: null, source_row_index: 1,
  }

  it('retains rule-based results and empty generated meanings when the selected task is unconfigured', async () => {
    const execution = createLlmExecution()
    mocks.configured.mockReturnValue(false)
    expect(await normalizeVocabEntries([entry], { useAi: true, execution })).toEqual(await normalizeVocabEntries([entry]))
    expect(await generateVariantMeanings([{
      id: 'variant-1', source_word: 'run', source_meaning: '달리다', word: 'runner',
      part_of_speech: 'n.', relation_type: 'derivative', usage_note: null, raw_text: null,
    }], { execution })).toEqual([])
    expect(mocks.configured).toHaveBeenCalledWith('vocab.enrich', execution)
    expect(mocks.text).not.toHaveBeenCalled()
  })

  it('reuses a single execution through forty-row batches and retains fallback on a failed batch', async () => {
    mocks.text.mockResolvedValueOnce('[]').mockRejectedValueOnce(new Error('provider failed'))
    const entries = Array.from({ length: 41 }, (_, index) => ({ ...entry, number: index + 1, english_word: `word${index}` }))
    const normalized = await normalizeVocabEntries(entries, { useAi: true })
    expect(normalized).toHaveLength(41)
    expect(mocks.text).toHaveBeenCalledTimes(2)
    const first = mocks.text.mock.calls[0][0]
    const second = mocks.text.mock.calls[1][0]
    expect(second.execution).toBe(first.execution)
    expect(first).toMatchObject({ task: 'vocab.enrich', maxTokens: 12000 })
    expect(second).toMatchObject({ task: 'vocab.enrich', maxTokens: 12000 })
    expect(normalized[40]).toEqual((await normalizeVocabEntries([entries[40]]))[0])
  })
})
