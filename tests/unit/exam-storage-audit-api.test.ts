import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfImportJob } from '@/lib/pdf-import/types'
const mocks = vi.hoisted(() => ({ user: true, teacher: true, audit: vi.fn(), jobs: [] as PdfImportJob[], from: vi.fn() }))
vi.mock('@/lib/pdf-import/exam-storage-audit-server', () => ({ reconcileExamStorage: mocks.audit }))
vi.mock('@/lib/api', () => ({
  getAuth: async () => ({ user: mocks.user ? { id: 'owner' } : null, supabase: { from: mocks.from } }),
  getTeacherId: async () => mocks.teacher ? 'teacher' : null,
  ok: (data: unknown) => Response.json(data), err: (error: string, status = 400) => Response.json({ error }, { status }),
}))
import { GET as list } from '@/app/api/pdf-import/jobs/route'
import { GET as detail } from '@/app/api/pdf-import/jobs/[id]/route'
const id = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks(); mocks.user = true; mocks.teacher = true
  mocks.jobs = [{ id, kind: 'bank_explanation', teacher_id: 'teacher', target_id: 'exam', status: 'succeeded', stage: '완료', payload: {}, result: { total: 28, updated: 27, skipped_questions: [] } } as unknown as PdfImportJob]
  mocks.from.mockImplementation((table: string) => {
    const query = { select: () => query, eq: () => query, neq: () => query, order: () => query, limit: () => query, in: () => query,
      single: async () => ({ data: mocks.jobs[0], error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === 'pdf_import_job' ? mocks.jobs : table === 'exam_bank' ? [{ id: 'exam', title: '2022년 9월 고3 모의고사' }] : [], error: null }).then(resolve),
    }; return query
  })
  mocks.audit.mockImplementation(async (_client, _teacher, jobs: PdfImportJob[]) => jobs.map((job) => ({ ...job, result: { ...job.result,
    storage_issues: [{ stage: 'explanations', question_number: 25, code: 'unmatched', reason: '연결할 문항 없음', attempts: 0 }] } })))
})
describe('job list and detail reconcile stored material before publishing completion', () => {
  it('list publishes corrected status and numbered reason and retains the material title', async () => {
    const response = await list(new Request('https://example.com/api/pdf-import/jobs'))
    expect(response.status).toBe(200)
    const [job] = await response.json()
    expect(job).toMatchObject({ status: 'failed', stage: '미완료 문항 확인 필요', display_title: '2022년 9월 고3 모의고사', can_retry: false,
      result: { storage_issues: [{ question_number: 25, reason: '연결할 문항 없음' }] } })
    expect(mocks.audit.mock.calls[0][1]).toBe('teacher')
    expect(job).not.toHaveProperty('payload')
  })
  it('detail uses the same correction', async () => {
    const response = await detail(new Request('https://example.com'), { params: Promise.resolve({ id }) })
    expect(await response.json()).toMatchObject({ status: 'failed', result: { storage_issues: [{ question_number: 25 }] } })
    expect(mocks.audit.mock.calls[0][1]).toBe('teacher')
  })
  it('does not audit an unauthenticated or unapproved request', async () => {
    mocks.user = false
    expect((await list(new Request('https://example.com'))).status).toBe(401)
    expect((await detail(new Request('https://example.com'), { params: Promise.resolve({ id }) })).status).toBe(401)
    mocks.user = true; mocks.teacher = false
    expect((await list(new Request('https://example.com'))).status).toBe(403)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('does not add the exam audit to weekly job polling', async () => {
    mocks.jobs[0].kind = 'week_answers'
    await list(new Request('https://example.com/api/pdf-import/jobs?weekId=week'))
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
