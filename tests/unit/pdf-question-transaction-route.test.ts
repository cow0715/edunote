import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, PATCH } from '@/app/api/weeks/[id]/questions/route'

const state = vi.hoisted(() => ({ from: vi.fn(), edit: vi.fn(), transaction: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api', () => ({
  getAuth: async () => ({ user: { id: 'verified-user' }, supabase: { from: state.from } }),
  getTeacherId: async () => 'teacher', assertWeekOwner: async () => true,
  ok: (data: unknown) => Response.json(data),
  err: (error: string, status = 400) => Response.json({ error }, { status }),
}))
vi.mock('@/lib/db/transaction', () => ({ withTeacherTransaction: state.transaction }))
vi.mock('@/lib/services/questions', () => ({ editQuestions: state.edit }))
const params = { params: Promise.resolve({ id: 'week' }) }
beforeEach(() => vi.clearAllMocks())

describe('PDF question route after transaction integration', () => {
  it('returns PDF order and preserves source numbers and choice data', async () => {
    const rows = [
      { id: 'first-key', question_number: 1, display_order: 2, source_question_number: 1, source_section: 'general' },
      { id: 'second-key', question_number: 2, display_order: 1, source_question_number: 1, source_section: 'written', exam_question_choice: [{ text: 'choice' }] },
    ]
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.order.mockReturnValue(query)
    state.from.mockReturnValue(query)
    const response = await GET(new Request('http://localhost/questions'), params)
    expect(await response.json()).toEqual([rows[1], rows[0]])
    expect(state.transaction).not.toHaveBeenCalled()
  })

  it('sends the complete answer-key edit batch to one authenticated transaction', async () => {
    const context = { tx: {}, teacherId: 'teacher' }
    const edits = [{ id: 'first-key', correct_answer: 3, concept_tag_ids: [] }, { id: 'second-key', is_void: true, concept_tag_ids: [] }]
    state.transaction.mockImplementation(async (_user, work) => work(context))
    state.edit.mockResolvedValue({ ok: true })
    const response = await PATCH(new Request('http://localhost/questions', { method: 'PATCH', body: JSON.stringify(edits) }), params)
    expect(response.status).toBe(200)
    expect(state.transaction).toHaveBeenCalledExactlyOnceWith('verified-user', expect.any(Function))
    expect(state.edit).toHaveBeenCalledExactlyOnceWith(context, 'week', edits)
    expect(state.from).not.toHaveBeenCalled()
  })
})
