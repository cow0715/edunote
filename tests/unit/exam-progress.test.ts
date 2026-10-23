import { describe, expect, it, vi } from 'vitest'
import { checkpointKey, type PdfWorkerContext } from '@/lib/pdf-import/context'
import { savedExamProgress } from '@/lib/pdf-import/exam-progress'
import type { PdfImportJob } from '@/lib/pdf-import/types'

describe('exam progress after a later failure', () => {
  it.each(['bank_questions', 'bank_explanation'] as const)('preserves both stage reasons without exposing word candidates for %s', async (kind) => {
    const values = new Map<string, unknown>([
      [checkpointKey({ phase: 'bank-questions-saved-v1', job: 'job' }), { question_count: 27, issues: [{ question_number: 22 }] }],
      [checkpointKey({ phase: 'bank-explanations-saved-v1', job: 'job' }), { updated: 26, mode: 'standard', issues: [{ question_number: 31 }], words: ['private candidates'] }],
    ])
    const context = { batchCall: vi.fn(), read: async <T>(key: string) => (values.get(key) ?? null) as T | null } as unknown as PdfWorkerContext
    const result = await savedExamProgress(context, { id: 'job', target_id: 'exam', kind } as PdfImportJob)
    expect(JSON.stringify(result)).not.toContain('private candidates')
    expect(result).toMatchObject(kind === 'bank_questions' ? { issues: [{ question_number: 22 }], explanation_result: { issues: [{ question_number: 31 }] } } : { issues: [{ question_number: 31 }] })
  })
  it('leaves weekly, textbooks and ordinary workers untouched', async () => {
    const read = vi.fn()
    for (const kind of ['bank_book', 'week_answers'] as const) expect(await savedExamProgress({ batchCall: vi.fn(), read } as unknown as PdfWorkerContext, { kind } as PdfImportJob)).toBeNull()
    expect(await savedExamProgress({ read } as unknown as PdfWorkerContext, { kind: 'bank_questions' } as PdfImportJob)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})
