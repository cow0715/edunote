import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfImportJob } from '@/lib/pdf-import/types'
import { NATIVE_RECOVERY_REVISION } from '@/lib/book-pdf/recovery-policy'

const mocks = vi.hoisted(() => ({
  previous: null as Record<string, unknown> | null,
  insertError: null as { code?: string; message: string } | null,
  copy: vi.fn(), remove: vi.fn(), insert: vi.fn(), update: vi.fn(), dispatch: vi.fn(), config: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: mocks.previous }),
      insert: async (row: unknown) => { mocks.insert(row); return { error: mocks.insertError } },
      update: (row: unknown) => { mocks.update(row); return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    }
    return query
  },
  storage: { from: () => ({ copy: mocks.copy, remove: mocks.remove }) },
}) }))
vi.mock('@/lib/pdf-import/gcp', () => ({ dispatchPdfJob: mocks.dispatch, gcpWorkerConfig: mocks.config }))
import { publicPdfJob, registerPdfImport } from '@/lib/pdf-import/server'

const input = { kind: 'bank_questions' as const, teacherId: 'teacher', authId: 'owner', storagePath: 'owner/file.pdf', payload: { title: '시험' } }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.previous = null; mocks.insertError = null
  mocks.copy.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null }); mocks.dispatch.mockResolvedValue(undefined)
})
describe('PDF job reservation', () => {
  it('rejects another user path or traversal before reading storage', async () => {
    await expect(registerPdfImport({ ...input, storagePath: 'someone/file.pdf' })).rejects.toThrow('경로')
    await expect(registerPdfImport({ ...input, storagePath: 'owner/../file.pdf' })).rejects.toThrow('경로')
    expect(mocks.copy).not.toHaveBeenCalled()
  })
  it('keeps originals before registration and associates an optional explanation with the same job', async () => {
    const result = await registerPdfImport({ ...input, explanationStoragePath: 'owner/exp.pdf' })
    expect(result.accepted).toBe(true)
    expect(mocks.copy).toHaveBeenCalledTimes(2)
    expect(mocks.copy.mock.calls[0][2]).toEqual({ destinationBucket: 'pdf-import-sources' })
    expect(mocks.insert.mock.calls[0][0].payload.explanationSourcePath).toContain('-explanation.pdf')
    expect(mocks.remove).toHaveBeenCalledWith(['owner/file.pdf', 'owner/exp.pdf'])
    expect(mocks.dispatch).toHaveBeenCalledWith(result.job_id, 'bank_questions')
  })
  it('returns the same job for a repeated upload without duplicating calls or deleting sources', async () => {
    mocks.previous = { id: 'saved', target_id: 'target', status: 'running' }
    expect(await registerPdfImport(input)).toEqual({ job_id: 'saved', target_id: 'target', status: 'running', accepted: true })
    expect(mocks.copy).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('reports accepted work even when temporary-file cleanup fails after reservation', async () => {
    mocks.remove.mockRejectedValueOnce(Error('network'))
    expect((await registerPdfImport({ ...input, kind: 'bank_book', targetId: 'book' })).target_id).toBe('book')
    expect(mocks.dispatch).toHaveBeenCalled()
  })
  it('retains queued work after uncertain dispatch and exposes a retryable error', async () => {
    mocks.dispatch.mockRejectedValue(Error('network timeout'))
    expect((await registerPdfImport(input)).accepted).toBe(true)
    expect(mocks.update.mock.calls[0][0].error).toContain('재실행')
    expect(mocks.remove).toHaveBeenCalledTimes(1)
  })
  it('cleans copied sources after reservation conflicts without deleting the temporary upload', async () => {
    mocks.insertError = { code: '23505', message: 'duplicate' }
    await expect(registerPdfImport(input)).rejects.toThrow('이미')
    expect(mocks.remove.mock.calls[0][0][0]).toMatch(/^teacher\/.+\.pdf$/)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('publishes status without private source paths, payload, or lease token', () => {
    const job: PdfImportJob = { id: 'id', teacher_id: 'teacher', kind: 'week_answers', target_id: 'target', status: 'running', lease_expires_at: new Date(Date.now() - 1).toISOString(),
      lease_token: 'secret', payload: { secret: 'private' }, source_path: 'private.pdf', completed_calls: 2,
      stage: '추출', attempt: 1, result: null, error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const result = publicPdfJob(job)
    expect(result.can_retry).toBe(true)
    expect(publicPdfJob({ ...job, kind: 'bank_book', status: 'failed', result: { verification_unresolved: true } }).can_retry).toBe(true)
    expect(publicPdfJob({ ...job, kind: 'bank_book', status: 'failed', result: { verification_unresolved: true, recovery_revision: NATIVE_RECOVERY_REVISION } }).can_retry).toBe(false)
    expect(result).not.toHaveProperty('lease_token')
    expect(result).not.toHaveProperty('payload')
    expect(result).not.toHaveProperty('source_path')
  })
})
