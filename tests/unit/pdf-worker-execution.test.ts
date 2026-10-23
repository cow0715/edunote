import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfImportJob } from '@/lib/pdf-import/types'
import { checkpointCall, getPdfWorkerContext, reportPdfStage } from '@/lib/pdf-import/context'
import { BookBatchPending, BookBatchRequestFailed, BookBatchStopped } from '@/lib/book-pdf/batch-policy'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), run: vi.fn(), single: vi.fn(), read: vi.fn() }))
const batchMock = vi.hoisted(() => ({ poll: vi.fn(), submit: vi.fn(), call: vi.fn(), wake: vi.fn() }))
vi.mock('@/lib/pdf-import/batch-transport', () => ({
  PdfBatchTransport: class { poll = batchMock.poll; submit = batchMock.submit; call = batchMock.call },
  anthropicPdfBatchProvider: vi.fn(),
}))
vi.mock('@/lib/pdf-import/batch-wake', () => ({ scheduleBookBatchWake: batchMock.wake }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  rpc: mocks.rpc,
  from: () => {
    const query = { select: () => query, eq: () => query, single: mocks.single, maybeSingle: mocks.read }
    return query
  },
}) }))
vi.mock('@/lib/pdf-import/handlers', () => ({ runPdfImport: mocks.run }))
import { main } from '../../scripts/pdf-worker'

const id = '9149b109-34e6-43b3-a215-53f6f87a66fa'
const job: PdfImportJob = { id, teacher_id: 'teacher', kind: 'bank_questions', target_id: 'exam', source_path: 'source.pdf', payload: {}, status: 'running', stage: '추출',
  completed_calls: 0, attempt: 1, lease_token: null, lease_expires_at: null, result: null, error: null, created_at: '', updated_at: '' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PDF_IMPORT_JOB_ID', id)
  vi.stubEnv('CLOUD_RUN_TASK_ATTEMPT', '0')
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'pdf_import_claim' ? [job] : true, error: null }))
  mocks.read.mockResolvedValue({ data: null, error: null })
  mocks.run.mockResolvedValue({ ok: true })
  batchMock.poll.mockResolvedValue(false)
  batchMock.submit.mockResolvedValue(undefined)
  batchMock.wake.mockResolvedValue('2026-10-21T15:00:00Z')
})
afterEach(() => { vi.unstubAllEnvs() })
describe('single-job worker execution', () => {
  it.each(['bank_questions', 'bank_explanation'] as const)('suspends %s after collecting requests and exits while awaiting results', async (kind) => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'pdf_import_claim' ? [{ ...job, kind, payload: { batchProcessing: 'batch-v1' } }] : true, error: null }))
    mocks.run.mockRejectedValueOnce(new BookBatchPending())
    await main()
    expect(batchMock.submit).toHaveBeenCalledTimes(1)
    expect(batchMock.wake.mock.invocationCallOrder[0]).toBeLessThan(batchMock.submit.mock.invocationCallOrder[0])
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_suspend_batch', expect.objectContaining({ p_id: id }))
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'pdf_import_finish')).toBe(false)
    batchMock.poll.mockResolvedValueOnce(true); mocks.run.mockClear()
    await main()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(batchMock.submit).toHaveBeenCalledTimes(1)
  })
  it('stops exhausted exam requests without restarting a paid platform attempt', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'pdf_import_claim' ? [{ ...job, payload: { batchProcessing: 'batch-v1' } }] : true, error: null }))
    mocks.run.mockRejectedValueOnce(new BookBatchRequestFailed('request exhausted'))
    await expect(main()).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_finish', expect.objectContaining({ p_status: 'failed', p_result: { batch_exhausted: true } }))
    expect(batchMock.submit).not.toHaveBeenCalled()
  })
  function batchJob() {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'pdf_import_claim' ? [{ ...job, kind: 'bank_book', payload: { bookProcessing: 'batch-v1' } }] : true, error: null }))
  }
  it('submits textbook requests, schedules continuation, releases its lease and exits without finishing', async () => {
    batchJob()
    mocks.run.mockImplementation(async () => {
      expect(getPdfWorkerContext()?.batchCall).toBe(batchMock.call)
      return { batch_waiting: true }
    })
    await main()
    expect(batchMock.submit).toHaveBeenCalledTimes(1)
    expect(batchMock.wake).toHaveBeenCalledTimes(1)
    expect(batchMock.wake.mock.invocationCallOrder[0]).toBeLessThan(batchMock.submit.mock.invocationCallOrder[0])
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_suspend_batch', expect.objectContaining({ p_id: id }))
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'pdf_import_finish')).toBe(false)
  })
  it('never sends a paid batch when the automatic continuation cannot be scheduled', async () => {
    batchJob(); mocks.run.mockResolvedValue({ batch_waiting: true }); batchMock.wake.mockRejectedValueOnce(Error('queue IAM missing'))
    await expect(main()).rejects.toThrow('queue IAM missing')
    expect(batchMock.submit).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_finish', expect.objectContaining({ p_status: 'queued' }))
  })
  it('checks a pending provider batch without downloading or reparsing the PDF', async () => {
    batchJob(); batchMock.poll.mockResolvedValue(true)
    await main()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(batchMock.submit).not.toHaveBeenCalled()
    expect(batchMock.wake).toHaveBeenCalledTimes(1)
  })
  it('continues to publication when batch responses are ready', async () => {
    batchJob(); mocks.run.mockResolvedValue({ auto_published: true, question_count: 119 })
    await main()
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_finish', expect.objectContaining({ p_status: 'succeeded' }))
    expect(batchMock.wake).not.toHaveBeenCalled()
  })
  it('does not automatically retry an uncertain batch submission', async () => {
    batchJob(); batchMock.poll.mockRejectedValue(new BookBatchStopped('uncertain batch'))
    await expect(main()).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_finish', expect.objectContaining({ p_status: 'failed', p_result: { batch_stopped: true } }))
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('checks ownership lease for stages, persists checkpoints, and records completion', async () => {
    mocks.run.mockImplementation(async () => {
      expect(getPdfWorkerContext()?.batchCall).toBeUndefined()
      await reportPdfStage('추출 중')
      await checkpointCall('question 18', async () => ({ passage: 'cached' }))
      return { question_count: 1 }
    })
    const signals = process.listenerCount('SIGTERM')
    await main()
    const claim = mocks.rpc.mock.calls.find(([name]) => name === 'pdf_import_claim')![1]
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_heartbeat', expect.objectContaining({ p_id: id, p_token: claim.p_token, p_stage: '추출 중' }))
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_save_checkpoint', expect.objectContaining({ p_token: claim.p_token, p_value: { passage: 'cached' } }))
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_finish', expect.objectContaining({ p_status: 'succeeded', p_result: { question_count: 1 } }))
    expect(process.listenerCount('SIGTERM')).toBe(signals)
  })
  it('requeues retryable task failure and marks the final automatic attempt failed', async () => {
    mocks.run.mockRejectedValue(Error('temporary API failure'))
    await expect(main()).rejects.toThrow('temporary API failure')
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_finish', expect.objectContaining({ p_status: 'queued' }))
    vi.stubEnv('CLOUD_RUN_TASK_ATTEMPT', '3')
    await expect(main()).rejects.toThrow('temporary API failure')
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_finish', expect.objectContaining({ p_status: 'failed' }))
  })
  it('exits without reparsing an already completed job or leaving signal listeners', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    mocks.single.mockResolvedValue({ data: { status: 'succeeded' }, error: null })
    const signals = process.listenerCount('SIGTERM')
    await main()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(process.listenerCount('SIGTERM')).toBe(signals)
  })
  it('records exhausted quality checks as failed without another paid platform retry', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'pdf_import_claim' ? [{ ...job, kind: 'bank_book' }] : true, error: null }))
    mocks.run.mockResolvedValue({ verification_unresolved: true, auto_published: false })
    await expect(main()).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith('pdf_import_finish', expect.objectContaining({ p_status: 'failed', p_result: { verification_unresolved: true, auto_published: false } }))
  })
})
