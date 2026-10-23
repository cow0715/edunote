import { describe, expect, it } from 'vitest'
import { allowsPdfBatchTask, isPdfBatchJob, PdfBatchPending, settlePdfBatchCalls } from '@/lib/pdf-import/batch-policy'

describe('PDF batch scope and collection', () => {
  it('opts in new exam jobs and existing textbook batches, leaving legacy and weekly jobs unchanged', () => {
    expect(isPdfBatchJob({ kind: 'bank_questions', payload: { batchProcessing: 'batch-v1' } })).toBe(true)
    expect(isPdfBatchJob({ kind: 'bank_explanation', payload: { batchProcessing: 'batch-v1' } })).toBe(true)
    expect(isPdfBatchJob({ kind: 'bank_book', payload: { bookProcessing: 'batch-v1' } })).toBe(true)
    expect(isPdfBatchJob({ kind: 'bank_questions', payload: {} })).toBe(false)
    expect(isPdfBatchJob({ kind: 'week_answers', payload: { batchProcessing: 'batch-v1' } })).toBe(false)
    expect(allowsPdfBatchTask('bank_explanation', 'examBank.parseQuestions')).toBe(false)
    expect(allowsPdfBatchTask('bank_book', 'vocab.enrich')).toBe(false)
  })
  it('drains asynchronous siblings before suspending and prioritizes terminal failures', async () => {
    let finished = false
    await expect(settlePdfBatchCalls([
      Promise.reject(new PdfBatchPending()),
      new Promise<number>((resolve) => setTimeout(() => { finished = true; resolve(1) }, 1)),
    ])).rejects.toBeInstanceOf(PdfBatchPending)
    expect(finished).toBe(true)
    await expect(settlePdfBatchCalls([Promise.reject(new PdfBatchPending()), Promise.reject(new Error('terminal'))])).rejects.toThrow('terminal')
    expect(await settlePdfBatchCalls([Promise.resolve(2), Promise.resolve(1)])).toEqual([2, 1])
  })
})
