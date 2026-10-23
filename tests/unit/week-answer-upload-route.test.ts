import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ from: vi.fn(), copy: vi.fn(), download: vi.fn(), draft: vi.fn(), register: vi.fn(), worker: false }))
vi.mock('@/lib/api', () => ({ getAuth: async () => ({ user: { id: 'auth' }, supabase: {} }), getTeacherId: async () => 'teacher', assertWeekOwner: async () => true,
  err: (error: string, status = 400) => Response.json({ error }, { status }), ok: (data: unknown, init?: ResponseInit) => Response.json(data, init) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: state.from, storage: { from: () => ({ copy: state.copy, download: state.download }) } }) }))
vi.mock('@/lib/pdf-import/types', () => ({ workerEnabled: () => state.worker }))
vi.mock('@/lib/pdf-import/server', () => ({ registerPdfImport: state.register }))
vi.mock('@/lib/week-reading-import', () => ({ fetchTeacherTagContext: async () => ({ tagCategories: [] }) }))
vi.mock('@/lib/week-answer-review-server', () => ({ currentAnswerKeys: async () => [], createWeekAnswerDraft: state.draft }))
import { POST } from '@/app/api/weeks/[id]/parse-answers/route'

const params = { params: Promise.resolve({ id: 'week' }) }
const files = [{ storagePath: 'week-import/week/question.pdf', fileName: '문제.pdf', mimeType: 'application/pdf' },
  { storagePath: 'week-import/week/answer.pdf', fileName: '해설.pdf', mimeType: 'application/pdf' }]
const request = (body: unknown) => new Request('http://localhost/parse', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks(); state.worker = false
  const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) }
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); state.from.mockReturnValue(q)
  state.copy.mockResolvedValue({ error: null }); state.download.mockResolvedValue({ data: new Blob(['pdf']), error: null })
  state.draft.mockResolvedValue({ draft_id: 'draft', needs_review: true, students_regraded: 0, answers_deleted: 0 })
  state.register.mockResolvedValue({ job_id: 'job' })
})
afterEach(() => vi.unstubAllEnvs())

describe('review-only PDF upload route', () => {
  it('keeps separate problem and explanation originals in one draft and never enters the old discard/regrade path', async () => {
    const response = await POST(request({ files, discardAnswers: true }), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ needs_review: true, answers_deleted: 0, students_regraded: 0 })
    expect(state.copy).toHaveBeenCalledTimes(2)
    expect(state.draft.mock.calls[0][1]).toMatchObject({ weekId: 'week', teacherId: 'teacher', files: [
      expect.objectContaining({ role: 'questions', fileName: '문제.pdf' }), expect.objectContaining({ role: 'answers', fileName: '해설.pdf' })] })
    expect(state.from.mock.calls.map(c => c[0])).toEqual(['week_answer_draft'])
  })
  it('rejects another week’s source path before reading or copying it', async () => {
    const response = await POST(request({ files: [{ ...files[0], storagePath: 'week-import/other/private.pdf' }] }), params)
    expect(response.status).toBe(400)
    expect(state.copy).not.toHaveBeenCalled()
    expect(state.draft).not.toHaveBeenCalled()
  })
  it('does not dispatch a review upload to an old auto-applying worker', async () => {
    state.worker = true
    const response = await POST(request({ files }), params)
    expect(response.status).toBe(503)
    expect(state.register).not.toHaveBeenCalled()
  })
  it('passes both durable sources to a ready review worker', async () => {
    state.worker = true; vi.stubEnv('WEEK_ANSWER_REVIEW_WORKER_READY', 'true')
    const response = await POST(request({ files }), params)
    expect(response.status).toBe(202)
    expect(state.register).toHaveBeenCalledWith(expect.objectContaining({ storagePath: files[0].storagePath,
      explanationStoragePath: files[1].storagePath, payload: expect.objectContaining({ reviewVersion: 1 }) }))
    expect(state.draft).not.toHaveBeenCalled()
  })
})
