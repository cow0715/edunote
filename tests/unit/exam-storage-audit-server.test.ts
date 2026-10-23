import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PdfImportJob } from '@/lib/pdf-import/types'
const mocks = vi.hoisted(() => ({ service: vi.fn(), checkpointPage: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.service }))
import { reconcileExamStorage } from '@/lib/pdf-import/exam-storage-audit-server'
import { publicPdfJob } from '@/lib/pdf-import/server'

const legacy = { id: 'job', teacher_id: 'teacher', target_id: 'exam', kind: 'bank_explanation', status: 'succeeded',
  stage: '완료', result: { mode: 'standard', total: 28, updated: 27, skipped_questions: [] }, payload: {}, created_at: '', updated_at: '' } as unknown as PdfImportJob
const numbers = Array.from({ length: 28 }, (_, i) => i + 18)
function client(options: { questionError?: boolean; bankError?: boolean; paginate?: boolean } = {}) {
  const calls: { table: string; filters: unknown[] }[] = []
  const db = { from(table: string) {
    const filters: unknown[] = []; calls.push({ table, filters })
    const query = { select: () => query, eq: (...values: unknown[]) => { filters.push(values); return query }, in: (...values: unknown[]) => { filters.push(values); return query }, order: () => query,
      range: async (from: number) => {
        const data = numbers.filter((n) => n !== 25).map((question_number) => ({ exam_bank_id: 'exam', question_number, explanation_intent: '의도', explanation_translation: '해석', explanation_solution: '풀이', explanation_vocabulary: '어휘' }))
        // Even a full page must be exhausted before deciding a row is missing.
        return { data: options.paginate && from === 0 ? Array.from({ length: 200 }, () => data[0]) : data,
          error: options.questionError ? { message: 'DB unavailable' } : null }
      },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'exam' }], error: options.bankError ? { message: 'unavailable' } : null }).then(resolve),
    }
    return query
  } } as unknown as SupabaseClient
  return { db, calls }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkpointPage.mockResolvedValue({ data: [{ task: 'examBank.extractExplanations', text: JSON.stringify(numbers.map((question_number) => ({ question_number, solution: '풀이' }))) }], error: null })
  mocks.service.mockImplementation(() => ({ from: () => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query, range: mocks.checkpointPage }
    return query
  } }))
})
describe('read-only server storage audit', () => {
  it('reports the real legacy shape as incomplete without changing its durable succeeded status', async () => {
    const f = client(), [reconciled] = await reconcileExamStorage(f.db, 'teacher', [legacy])
    const published = publicPdfJob(reconciled)
    expect(published.status).toBe('failed'); expect(published.stage).toBe('미완료 문항 확인 필요'); expect(published.can_retry).toBe(false)
    expect(published.result?.storage_issues).toMatchObject([{ question_number: 25, code: 'unmatched' }])
    expect(legacy.result).not.toHaveProperty('storage_issues'); expect(legacy.status).toBe('succeeded')
    expect(JSON.stringify(published)).not.toContain('extractExplanations')
    expect(f.calls[0].filters).toContainEqual(['teacher_id', 'teacher'])
  })
  it('does not query private checkpoints for another teacher or active, weekly, or book jobs', async () => {
    const f = client(), jobs = [{ ...legacy, teacher_id: 'other' }, { ...legacy, status: 'running' }, { ...legacy, kind: 'week_answers' }, { ...legacy, kind: 'bank_book' }] as PdfImportJob[]
    expect(await reconcileExamStorage(f.db, 'teacher', jobs)).toBe(jobs)
    expect(f.calls).toHaveLength(0); expect(mocks.service).not.toHaveBeenCalled()
  })
  it.each(['bank', 'question', 'checkpoint'])('withholds completion when %s reads fail', async (kind) => {
    const f = client({ bankError: kind === 'bank', questionError: kind === 'question' })
    if (kind === 'checkpoint') mocks.checkpointPage.mockResolvedValue({ data: null, error: { message: 'private' } })
    const [reconciled] = await reconcileExamStorage(f.db, 'teacher', [legacy])
    expect(publicPdfJob(reconciled)).toMatchObject({ status: 'failed', can_retry: false, error: expect.stringContaining('대조하지 못했습니다') })
  })
  it('reads every stored question page before declaring a number absent', async () => {
    const [reconciled] = await reconcileExamStorage(client({ paginate: true }).db, 'teacher', [legacy])
    expect(reconciled.result?.storage_issues).toMatchObject([{ question_number: 25 }])
  })
})
