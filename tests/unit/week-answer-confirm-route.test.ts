import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), copy: vi.fn(), render: vi.fn(), download: vi.fn(), data: {} as Record<string, unknown> }))
vi.mock('@/lib/api', () => ({ getAuth: async () => ({ user: { id: 'verified-auth' }, supabase: {} }), getTeacherId: async () => 'teacher', assertWeekOwner: async () => true,
  err: (error: string, status = 400) => Response.json({ error }, { status }), ok: (data: unknown) => Response.json(data) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: state.from, rpc: state.rpc, storage: { from: () => ({ copy: state.copy, download: state.download }) } }) }))
vi.mock('@/lib/week-reading-import', () => ({ fetchTeacherTagContext: async () => ({ tagList: [] }), createTagMatcher: () => () => null, renderPdfPageToPng: state.render }))
import { GET, POST } from '@/app/api/weeks/[id]/answer-review/route'

const params = { params: Promise.resolve({ id: 'week' }) }
const question = { question_number: 1, sub_label: null, question_style: 'objective', correct_answer: 4, correct_answer_text: null, evidence_verified: true }
const request = (actions: unknown) => new Request('http://localhost/review', { method: 'POST', body: JSON.stringify({ draft_id: 'draft', actions, teacher_id: 'forged', user_id: 'forged' }) })
beforeEach(() => {
  vi.clearAllMocks()
  state.data = { id: 'draft', status: 'review', answers: [question], base_questions: [], sources: [{ bucket: 'pdf-import-sources', path: 'teacher/source.pdf', sha256: 'hash' }] }
  const q = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({ data: state.data, error: null })) }
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); state.from.mockReturnValue(q)
  state.rpc.mockResolvedValue({ data: { ok: true }, error: null }); state.copy.mockResolvedValue({ error: null }); state.download.mockResolvedValue({ data: null, error: {} })
})

describe('review confirmation route', () => {
  it('derives the actor from verified auth and delegates the whole reviewed batch to the atomic RPC', async () => {
    const response = await POST(request([{ index: 0, reviewed: true }]), params)
    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith('confirm_week_answer_draft', expect.objectContaining({ p_teacher_id: 'teacher', p_auth_id: 'verified-auth', p_id: 'draft' }))
    expect(state.copy).toHaveBeenCalledWith('teacher/source.pdf', 'week/draft-source.pdf', { destinationBucket: 'answer-sheets' })
  })
  it('does not publish keys if the immutable original cannot be preserved', async () => {
    state.copy.mockResolvedValue({ error: { message: 'storage failed' } })
    const response = await POST(request([{ index: 0, reviewed: true }]), params)
    expect(response.status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('never replaces an existing key or its original PDF during confirmation', async () => {
    state.data.base_questions = [{ ...question, id: 'original', correct_answer: 3 }]
    expect((await POST(request([{ index: 0, reviewed: true }]), params)).status).toBe(400)
    expect(state.rpc).not.toHaveBeenCalled()
    expect((await POST(request([{ index: 0, reviewed: true, keep_existing: true }]), params)).status).toBe(200)
    expect(state.copy).not.toHaveBeenCalled()
    expect(state.rpc.mock.calls[0][1].p_answers[0].correct_answer).toBe(3)
  })
  it('rejects unsupported answers that have not been explicitly entered and reviewed', async () => {
    state.data.answers = [{ ...question, correct_answer: 0, evidence_verified: false }]
    expect((await POST(request([{ index: 0, reviewed: true }]), params)).status).toBe(400)
    expect(state.copy).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it('renders only an owned source and a valid page without mutating keys or answers', async () => {
    state.data.sources = [{ bucket: 'pdf-import-sources', path: 'teacher/source.pdf', pageCount: 2 }]
    state.download.mockResolvedValue({ data: new Blob(['original-pdf']), error: null })
    state.render.mockResolvedValue({ buffer: Buffer.from('png'), width: 900, height: 1300 })
    const url = 'http://localhost/review?draft=draft&source=0&view=page&page='
    const response = await GET(new Request(url + '2'), params)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(state.render).toHaveBeenCalledWith(Buffer.from('original-pdf').toString('base64'), 2)
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.copy).not.toHaveBeenCalled()
    expect((await GET(new Request(url + '3'), params)).status).toBe(400)
    state.data.sources = [{ bucket: 'pdf-import-sources', path: 'another-teacher/file', pageCount: 2 }]
    expect((await GET(new Request(url + '1'), params)).status).toBe(404)
    expect(state.download).toHaveBeenCalledTimes(1)
  })
  it('reports source rendering failures rather than showing a blank success', async () => {
    state.data.sources = [{ bucket: 'pdf-import-sources', path: 'teacher/source.pdf', pageCount: 2 }]
    state.download.mockResolvedValue({ data: new Blob(['pdf']), error: null })
    state.render.mockRejectedValue(new Error('render failure'))
    expect((await GET(new Request('http://localhost/review?draft=draft&source=0&view=page&page=1'), params)).status).toBe(503)
    expect(state.rpc).not.toHaveBeenCalled()
  })

})
