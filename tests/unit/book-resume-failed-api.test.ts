import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { PdfImportJob } from '@/lib/pdf-import/types'
const m = vi.hoisted(() => ({ user: true, job: null as PdfImportJob | null, dispatch: vi.fn(), service: vi.fn(),
  filters: [] as unknown[][], updates: [] as Record<string, unknown>[], cas: true, active: false, stop: null as string | null, bundleStop: null as string | null }))
vi.mock('@/lib/api', () => ({ getAuth: async () => ({ user: m.user ? { id: 'auth' } : null, supabase: { from: () => {
  const q = { select: () => q, eq: (...a: unknown[]) => { m.filters.push(a); return q }, single: async () => ({ data: m.job, error: null }) }; return q
} } }), getTeacherId: async () => 'teacher', err: (error: string, status = 400) => Response.json({ error }, { status }), ok: (data: unknown, init?: ResponseInit) => Response.json(data, init) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: m.service }))
vi.mock('@/lib/pdf-import/gcp', () => ({ dispatchPdfJob: m.dispatch }))
import { POST } from '@/app/api/pdf-import/jobs/[id]/resume-failed/route'
const id = '11111111-1111-4111-8111-111111111111', snapshot = '2026-11-02T00:00:00Z', params = { params: Promise.resolve({ id }) }
const failure = { unit_key: 'unit-2', source_hash: 'a'.repeat(64), stage: 'enrichment', attempt_id: null, labels: ['1강 2번'], reasons: ['형식 오류'] }
const request = (body: unknown = { units: ['unit-2'], snapshot, confirm: true }) => new Request('https://example.com', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('PDF_IMPORT_WORKER_ENABLED', 'true')
  m.user = true; m.cas = true; m.active = false; m.stop = null; m.bundleStop = null; m.filters = []; m.updates = []
  m.job = { id, kind: 'bank_book', teacher_id: 'teacher', target_id: 'doc', status: 'failed', updated_at: snapshot, lease_token: null,
    payload: { bookProcessing: 'batch-v1', keep: 'original' }, result: { manual_resume_only: true, book_failures: [failure] } } as unknown as PdfImportJob
  m.dispatch.mockResolvedValue(undefined)
  m.service.mockImplementation(() => ({ from: (table: string) => {
    const q = { select: () => q, eq: (...a: unknown[]) => { m.filters.push([table, ...a]); return q }, is: (...a: unknown[]) => { m.filters.push([table, ...a]); return q },
      in: () => q, limit: async () => ({ data: m.active ? [{ id: 'active' }] : [], error: null }),
      update: (value: Record<string, unknown>) => { m.updates.push(value); return q }, maybeSingle: async () => ({ error: null,
        data: table === 'book_pdf_cost_control' ? { stop_reason: m.stop } : table === 'book_pdf_bundle_file' ? { bundle_id: 'bundle' }
          : table === 'book_pdf_bundle' ? { stop_reason: m.bundleStop } : m.cas ? { id } : null }) }
    return q
  } }))
})
afterEach(() => vi.unstubAllEnvs())
describe('owned failed-only textbook resume', () => {
  it('queues only selected failures with a new durable attempt and preserves all other job payload/counters', async () => {
    expect((await POST(request(), params)).status).toBe(202)
    expect(m.filters).toContainEqual(['teacher_id', 'teacher'])
    expect(m.filters).toContainEqual(['pdf_import_job', 'status', 'failed'])
    expect(m.filters).toContainEqual(['pdf_import_job', 'updated_at', snapshot])
    const update = m.updates[0]
    expect(update).toMatchObject({ status: 'queued', payload: { bookProcessing: 'batch-v1', keep: 'original', bookFailureResume: {
      id: expect.stringMatching(/^[a-f0-9-]{36}$/), units: [{ unit_key: 'unit-2', stage: 'enrichment', source_hash: failure.source_hash }] } } })
    expect(update).not.toHaveProperty('completed_calls'); expect(update).not.toHaveProperty('attempt'); expect(update).not.toHaveProperty('result')
    expect(m.dispatch).toHaveBeenCalledExactlyOnceWith(id, 'bank_book')
  })
  it.each([{ units: ['unit-1'], snapshot, confirm: true }, { units: ['unit-2', 'unit-2'], snapshot, confirm: true },
    { units: ['unit-2'], snapshot: 'stale', confirm: true }, { units: ['unit-2'], snapshot, confirm: false }])('rejects unfailed, duplicate, stale or unconfirmed requests %j', async body => {
    expect((await POST(request(body), params)).status).toBeGreaterThanOrEqual(400)
    expect(m.dispatch).not.toHaveBeenCalled(); expect(m.updates).toHaveLength(0)
  })
  it.each(['active', 'file', 'bundle', 'excluded', 'running', 'uncertain'] as const)('preserves the %s guard', async mode => {
    if (mode === 'active') m.active = true
    if (mode === 'file') m.stop = 'legacy_review_required'
    if (mode === 'bundle') m.bundleStop = 'manual_resume_required'
    if (mode === 'excluded') m.job!.payload.recoveryExcluded = true
    if (mode === 'running') m.job!.status = 'running'
    if (mode === 'uncertain') m.job!.result!.batch_stopped = true
    expect((await POST(request(), params)).status).toBe(409)
    expect(m.dispatch).not.toHaveBeenCalled(); expect(m.updates).toHaveLength(0)
  })
  it('does not dispatch on a lost compare-and-set or invalid ownership', async () => {
    m.cas = false; expect((await POST(request(), params)).status).toBe(409); expect(m.dispatch).not.toHaveBeenCalled()
    m.user = false; expect((await POST(request(), params)).status).toBe(401)
    m.user = true; m.job = null; expect((await POST(request(), params)).status).toBe(404)
  })
})
