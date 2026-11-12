import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ auth: vi.fn(), teacher: vi.fn(), owner: vi.fn(), ai: vi.fn(), rpc: vi.fn(), revision: 1,
  failTotals: false, score: 2, answers: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/api', () => ({ getAuth: m.auth, getTeacherId: m.teacher, assertWeekOwner: m.owner,
  ok: (body: unknown) => Response.json(body), err: (error: string, status = 400) => Response.json({ error }, { status }) }))
vi.mock('@/lib/anthropic', () => ({ gradeVocabItems: m.ai }))
import { PATCH, POST } from '@/app/api/vocab-answer/route'

function query(table: string) {
  let selection = '', changes: Record<string, unknown> | undefined, answerId: unknown
  const result = () => {
    if (table === 'vocab_test') return { data: null, error: null }
    if (table === 'prompts') return { data: null, error: null }
    if (changes) {
      if (table === 'week_score') m.score = changes.vocab_correct as number
      else for (const answer of m.answers) if (answer.id === answerId) Object.assign(answer, changes)
      return { data: null, error: null }
    }
    if (selection === 'is_correct' && m.failTotals) return { data: null, error: { message: 'read failed' } }
    return { data: m.answers.map((answer) => ({ ...answer })), error: null }
  }
  const q = { select: (value: string) => { selection = value; return q },
    in: () => q, eq: (key: string, value: unknown) => { if (key === 'id') answerId = value; return q },
    update: (value: Record<string, unknown>) => { changes = value; return q },
    order: () => q, limit: () => q, maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
  return q
}
beforeEach(() => {
  vi.resetAllMocks()
  m.revision = 1
  m.rpc.mockImplementation(async (_name: string, args: { p_expected_revision: number }) => {
    if (args.p_expected_revision !== m.revision) return { data: null, error: { code: '40001', message: '답안이 변경됐습니다.' } }
    return { data: null, error: { code: '42501', message: '집계 읽기 실패' } }
  })
  m.failTotals = false
  m.score = 1
  m.answers = [{ id: 'answer', week_score_id: 'score', week_score: { week_id: 'week' },
    student_answer: 'old', is_correct: true, teacher_locked: false, test_source: null,
    vocab_word: { correct_answer: '정답', english_word: 'alpha', example_sentence: null }, vocab_word_variant: null }]
  m.teacher.mockResolvedValue('teacher')
  m.owner.mockResolvedValue(true)
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: { from: query, rpc: m.rpc } })
})
const request = (body: Record<string, unknown>) => new Request('http://local.test/vocab-answer', { method: 'POST', body: JSON.stringify({ ...body, grade_version: { score_id: 'score', revision: 1 } }) })

describe('audit of the separate edited-vocab regrading path', () => {
  it('rejects an old AI result after a newer teacher lock and answer', async () => {
    let finish!: (value: unknown) => void
    m.ai.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = POST(request({ weekScoreId: 'score', items: [{ id: 'answer', number: 1, english_word: 'alpha', student_answer: 'old' }] }))
    await vi.waitFor(() => expect(m.ai).toHaveBeenCalledOnce())
    Object.assign(m.answers[0], { student_answer: 'teacher corrected', is_correct: true, teacher_locked: true })
    m.revision = 2
    finish([{ number: 1, english_word: 'alpha', student_answer: 'old', is_correct: false }])
    expect((await pending)?.status).toBe(409)
    expect(m.answers[0]).toMatchObject({ student_answer: 'teacher corrected', is_correct: true, teacher_locked: true })
  })
  it('propagates transactional read failure without changing answers or totals', async () => {
    m.failTotals = true
    const response = await PATCH(request({ id: 'answer', student_answer: 'corrected', is_correct: true, teacher_locked: true }))
    expect(response?.status).toBe(403)
    expect(m.score).toBe(1)
    expect(m.answers[0]).toMatchObject({ student_answer: 'old', is_correct: true, teacher_locked: false })
  })
})
