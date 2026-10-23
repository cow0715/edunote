import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/share/[token]/retake/[weekId]/route'
import { SaveError } from '@/lib/db/errors'
const state = vi.hoisted(() => ({ details: [] as unknown[], writes: 0, filters: [] as unknown[][], capture: vi.fn(), save: vi.fn(), ai: vi.fn(), events: [] as string[] }))
vi.mock('@/lib/anthropic', () => ({ gradeVocabItems: state.ai }))
vi.mock('@/lib/services/shared-retake', () => ({ captureSharedRetake: state.capture, saveSharedRetake: state.save }))
vi.mock('@/lib/share-access', () => ({ resolveShareToken: async () => ({ status: 'ok', student: { id: 'student' } }), canViewShareByStudentId: async () => true }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({ from: (table: string) => {
 const q = { select: () => q, eq: (...args: unknown[]) => { if (table === 'student_vocab_answer') state.filters.push(args); return q }, is: () => q, in: () => q, order: () => q, limit: () => q,
 update: () => { state.writes++; throw new Error('Direct REST writes must not run') }, single: () => q, maybeSingle: () => q, then: (resolve: (value: unknown) => unknown) => {
 const data = table === 'class_student' ? { student_id: 'student' } : table === 'class' ? { archived_at: null } : table === 'week_score' ? { id: 'score' } : table === 'week' ? { class_id: 'class' } : table === 'student_vocab_answer' ? state.details : null
 return Promise.resolve(resolve({ data, error: null }))
 }}; return q
} }) }))
const answerId = '00000000-0000-4000-8000-000000000001'
const own = { id: answerId, test_source: 'example', vocab_word_id: 'word', vocab_word: { english_word: 'apple', example_sentence: 'apple', correct_answer: '사과' }, vocab_word_variant: null }
const submit = (answers: unknown) => POST(new Request('http://localhost/api/retake', { method: 'POST', body: JSON.stringify({ answers }), headers: { 'content-type': 'application/json' } }), { params: Promise.resolve({ token: 'token', weekId: 'week' }) })
const answer = { answer_id: answerId, english_word: 'apple', retake_answer: 'apple' }
beforeEach(() => {
 vi.resetAllMocks(); state.details = [own]; state.writes = 0; state.filters = []; state.events = []
 state.capture.mockImplementation(async () => { state.events.push('capture'); return { scoreId: 'score' } })
 state.save.mockImplementation(async () => { state.events.push('save'); return { total_mastered: 1, remaining: 0 } })
 state.ai.mockImplementation(async () => { throw new Error('Paid AI must not run') })
})
describe('retake submission scope and transaction boundary', () => {
 it('rejects foreign student/week or originally correct IDs before persistence', async () => { state.details = []; expect((await submit([answer])).status).toBe(400); expect(state.save).not.toHaveBeenCalled(); expect(state.filters).toContainEqual(['week_score_id', 'score']); expect(state.filters).toContainEqual(['is_correct', false]) })
 it('rejects duplicate IDs', async () => { expect((await submit([answer, answer])).status).toBe(400); expect(state.save).not.toHaveBeenCalled() })
 it('rejects malformed and empty submissions', async () => { for (const input of [null, [], [{ answer_id: 'invalid' }]]) expect((await submit(input)).status).toBe(400); expect(state.save).not.toHaveBeenCalled() })
 it('grades blanks without AI and persists through a single transaction service', async () => {
  const r = await submit([answer]); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ total_mastered: 1, remaining: 0, results: [{ is_correct: true }] })
  expect(state.save).toHaveBeenCalledExactlyOnceWith('token', 'week', { scoreId: 'score' }, [{ answer_id: answerId, retake_answer: 'apple', is_correct: true }])
  expect(state.writes).toBe(0); expect(state.ai).not.toHaveBeenCalled()
 })
 it('runs AI between capture and atomic persistence', async () => {
  state.details = [{ ...own, test_source: 'word' }]
  state.ai.mockImplementation(async () => { state.events.push('ai'); return [{ is_correct: true }] })
  expect((await submit([answer])).status).toBe(200); expect(state.events).toEqual(['capture', 'ai', 'save'])
 })
 it('does not save when AI fails', async () => { state.details = [{ ...own, test_source: 'word' }]; expect((await submit([answer])).status).toBe(500); expect(state.save).not.toHaveBeenCalled() })
 it('returns conflict without a REST fallback when grading inputs changed', async () => { state.save.mockRejectedValue(new SaveError('changed', 409)); expect((await submit([answer])).status).toBe(409); expect(state.writes).toBe(0) })
 it('does not report success on transaction failure', async () => { state.save.mockRejectedValue(new Error('injected')); expect((await submit([answer])).status).toBe(503); expect(state.writes).toBe(0) })
})
