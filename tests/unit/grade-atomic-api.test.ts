import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  finalize: vi.fn(),
  auth: vi.fn(), teacher: vi.fn(), owner: vi.fn(), readingAI: vi.fn(), vocabAI: vi.fn(), rpc: vi.fn(),
  upload: vi.fn(), info: vi.fn(), directWrite: vi.fn(), failTable: '',
  events: [] as string[],
  questions: [] as Record<string, unknown>[],
  words: [] as Record<string, unknown>[],
  activeTest: null as Record<string, unknown> | null,
}))
vi.mock('@/lib/api', () => ({ getAuth: m.auth, getTeacherId: m.teacher, assertWeekOwner: m.owner,
  ok: (body: unknown) => Response.json(body), err: (error: string, status = 400) => Response.json({ error }, { status }) }))
vi.mock('@/lib/anthropic', () => ({ gradeSubjectiveAnswers: m.readingAI, gradeVocabPhoto: m.vocabAI }))
vi.mock('@/lib/db/exam-photo-transaction', () => ({ saveExamPhotoFinalization: m.finalize }))
import { GET, PATCH as saveMetadata, POST as saveReading } from '@/app/api/weeks/[id]/grade/route'
import { POST as saveVocab } from '@/app/api/weeks/[id]/grade-vocab-photo/route'
import { recalcReadingCorrect } from '@/lib/grade-utils'
import { gradePersistenceStatus } from '@/lib/atomic-grade'
import type { SupabaseServerClient } from '@/lib/api'

const params = { params: Promise.resolve({ id: 'week' }) }
const row = { student_id: 'student', student_name: 'sample', present: true, reading_present: true,
  grade_version: { score_id: 'score', revision: 7 },
  reading_correct: 0, vocab_correct: 0, homework_done: null, memo: '',
  answers: [{ exam_question_id: 'q1', student_answer: 1 }] }
const req = (body: unknown) => new Request('http://localhost/grade', { method: 'POST', body: JSON.stringify(body) })
const vocabRequest = () => req({ studentId: 'student', fileData: 'cGhvdG8=', mimeType: 'image/jpeg' })

function query(table: string) {
  const result = (single = false) => {
    if (m.failTable === table) return { data: null, error: { message: 'simulated read failure' } }
    let data: unknown = table === 'week' ? { id: 'week', class_id: 'class', start_date: '2026-10-29', vocab_source_type: 'legacy' }
      : table === 'class_student' ? [{ student_id: 'student', student: { name: 'sample' } }]
      : table === 'week_score' ? [{ id: 'score', student_id: 'student', grade_revision: 7, student_answer: [] }]
      : table === 'exam_question' ? m.questions
      : table === 'vocab_word' ? m.words
      : table === 'vocab_test' ? m.activeTest
      : table === 'prompts' ? null : []
    if (single && Array.isArray(data)) data = data[0] ?? null
    return { data, error: null }
  }
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, lte: () => q, or: () => q, is: () => q,
    single: async () => result(true), maybeSingle: async () => result(true),
    then: (resolve: (result: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    upsert: m.directWrite, insert: m.directWrite, update: m.directWrite, delete: m.directWrite,
  }
  return q
}
beforeEach(() => {
  vi.resetAllMocks()
  m.events.length = 0
  m.failTable = ''
  m.activeTest = null
  m.questions = [{ id: 'q1', question_number: 1, sub_label: null, question_style: 'objective', correct_answer: 1 }]
  m.words = [{ id: 'v1', number: 1, english_word: 'alpha', correct_answer: 'a' }, { id: 'v2', number: 2, english_word: 'beta', correct_answer: 'b' }]
  m.teacher.mockResolvedValue('teacher')
  m.owner.mockResolvedValue(true)
  m.rpc.mockImplementation(async (name: string) => {
    m.events.push('commit')
    return { data: name === 'save_week_vocab_grade' ? { vocab_correct: 1, vocab_total: 2 }
      : [{ student_id: 'student', score_id: 'score', revision: 8 }], error: null }
  })
  m.upload.mockImplementation(async () => { m.events.push('upload'); return { error: null } })
  m.info.mockImplementation(async () => { m.events.push('verify'); return { data: { size: 5 }, error: null } })
  m.vocabAI.mockResolvedValue([{ number: 1, english_word: 'alpha', student_answer: 'wrong', is_correct: false },
    { number: 2, english_word: 'beta', student_answer: 'wrong', is_correct: false }])
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: { from: query, rpc: m.rpc,
    storage: { from: () => ({ upload: m.upload, info: m.info }) } } })
})

describe('fail-closed grade reads', () => {
  it.each(['week', 'week_score', 'exam_question', 'class_student', 'vocab_word', 'vocab_test', 'attendance'])('does not return empty successful data when %s fails', async (table) => {
    m.failTable = table
    expect((await GET(new Request('http://localhost/grade'), params)).status).toBe(503)
    expect(m.directWrite).not.toHaveBeenCalled()
  })
  it('does not hide failed active-test item reads', async () => {
    m.activeTest = { id: 'test' }
    m.failTable = 'vocab_test_item'
    expect((await GET(new Request('http://localhost/grade'), params)).status).toBe(503)
  })
  it('propagates recalc errors instead of replacing scores with null', async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    await expect(recalcReadingCorrect({ rpc: m.rpc } as unknown as SupabaseServerClient, ['score'])).rejects.toThrow('기존 점수는 유지')
    expect(m.directWrite).not.toHaveBeenCalled()
  })
})

describe('single-commit reading saves', () => {
  it('passes the screen revision unchanged so the transaction rejects an already stale screen', async () => {
    const staleRow = { ...row, grade_version: { score_id: 'score', revision: 2 }, memo: 'stale screen' }
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001', message: '답안이 변경됐습니다.' } })
    expect((await saveReading(req({ rows: [staleRow], skip_ai: true }), params)).status).toBe(409)
    expect(m.rpc.mock.calls[0][1].p_rows[0]).toMatchObject({ expected_revision: 2, memo: 'stale screen' })
  })
  it.each([{ present: false }, { reading_present: false }])('skips stale-question validation when answers are not being saved: %j', async (flags) => {
    const response = await saveReading(req({ rows: [{ ...row, ...flags,
      answers: [{ exam_question_id: 'deleted-question', student_answer: 1 }] }], skip_ai: true }), params)
    expect(response.status).toBe(200)
    expect(m.rpc.mock.calls[0][1].p_rows[0].answers).toEqual([])
  })
  it('rejects missing versions rather than silently adopting the latest version', async () => {
    expect((await saveReading(req({ rows: [{ ...row, grade_version: undefined }], skip_ai: true }), params)).status).toBe(409)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('returns the committed version for subsequent drafts', async () => {
    const response = await saveReading(req({ rows: [row], skip_ai: true }), params)
    expect(await response.json()).toEqual({ ok: true, versions: [{ student_id: 'student', score_id: 'score', revision: 8 }] })
  })
  it('finalizes an exam photo job through its replay-safe transaction and returns the original versions', async () => {
    const versions = [{ student_id: 'student', score_id: 'score', revision: 8 }]
    m.finalize.mockResolvedValueOnce({ versions, replayed: true })
    m.questions[0].question_style = 'subjective'
    const graded = { ...row, exam_photo_path: 'week/student/job',
      answers: [{ exam_question_id: 'q1', student_answer: null, student_answer_text: '답안', is_correct: true }] }
    const response = await saveReading(req({ rows: [graded], finalizePhotoJobId: 'job' }), params)
    expect(await response.json()).toEqual({ ok: true, versions })
    expect(m.finalize).toHaveBeenCalledExactlyOnceWith('user', 'teacher', 'week', 'job',
      [expect.objectContaining({ expected_revision: 7, exam_photo_path: 'week/student/job',
        answers: [expect.objectContaining({ is_correct: true })] })],
    )
    expect(m.rpc).not.toHaveBeenCalled()
    expect(m.readingAI).not.toHaveBeenCalled()
  })
  it('uses the same version guard for metadata and does not clear omitted homework', async () => {
    const response = await saveMetadata(req({ student_id: 'student', grade_version: row.grade_version, memo: 'new' }), params)
    expect(response.status).toBe(200)
    expect(m.rpc).toHaveBeenCalledWith('save_week_grade_metadata', expect.objectContaining({ p_expected_revision: 7, p_changes: { memo: 'new' } }))
  })
  it('prepares the entire batch and commits once with the observed revision', async () => {
    expect((await saveReading(req({ rows: [row], skip_ai: true }), params)).status).toBe(200)
    expect(m.directWrite).not.toHaveBeenCalled()
    expect(m.rpc).toHaveBeenCalledTimes(1)
    expect(m.rpc).toHaveBeenCalledWith('save_week_reading_grades', expect.objectContaining({ p_rows: [expect.objectContaining({ score_id: 'score', expected_revision: 7 })] }))
  })
  it('does not write provisional answers before AI completes and rejects stale results', async () => {
    m.questions = [{ id: 'q1', question_number: 1, sub_label: null, question_style: 'subjective', correct_answer_text: 'reference' }]
    let finish!: (results: unknown) => void
    m.readingAI.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = saveReading(req({ rows: [{ ...row, answers: [{ exam_question_id: 'q1', student_answer: null, student_answer_text: 'old answer' }] }] }), params)
    await vi.waitFor(() => expect(m.readingAI).toHaveBeenCalledOnce())
    expect(m.rpc).not.toHaveBeenCalled()
    expect(m.directWrite).not.toHaveBeenCalled()
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: '40001', message: '답안이 변경됐습니다.' } })
    finish([{ week_score_id: 'score', exam_question_id: 'q1', is_correct: true, needs_review: false, ai_feedback: '' }])
    expect((await pending).status).toBe(409)
  })
  it('does not partially save the batch when AI fails', async () => {
    m.questions = [{ id: 'q1', question_number: 1, sub_label: null, question_style: 'subjective', correct_answer_text: 'reference' }]
    m.readingAI.mockRejectedValueOnce(Error('timeout'))
    const response = await saveReading(req({ rows: [{ ...row, answers: [{ exam_question_id: 'q1', student_answer: null, student_answer_text: 'answer' }] }] }), params)
    expect(response.status).toBe(503)
    expect(m.rpc).not.toHaveBeenCalled()
    expect(m.directWrite).not.toHaveBeenCalled()
  })
  it('does not attempt a commit after failed question reads', async () => {
    m.failTable = 'exam_question'
    expect((await saveReading(req({ rows: [row] }), params)).status).toBe(503)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('preserves confirmed O/X selection and correction in the transaction payload', async () => {
    m.questions = [{ id: 'q1', question_number: 1, question_style: 'ox', correct_answer_text: 'X fixed' }]
    expect((await saveReading(req({ rows: [{ ...row, answers: [{ exam_question_id: 'q1', student_answer: null,
      student_answer_text: 'X fixed', is_correct: true, teacher_confirmed: true }] }], skip_ai: true }), params)).status).toBe(200)
    expect(m.rpc.mock.calls[0][1].p_rows[0].answers[0]).toMatchObject({ ox_selection: 'X', student_answer_text: 'fixed' })
  })
})

describe('complete, evidence-backed vocab saves', () => {
  it('does not fall back to the word bank for an empty active test', async () => {
    m.activeTest = { id: 'test', item_count: 0 }
    expect((await saveVocab(vocabRequest(), params)).status).toBe(422)
    expect(m.vocabAI).not.toHaveBeenCalled()
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('rejects incomplete results before any photo or grade write', async () => {
    m.vocabAI.mockResolvedValueOnce([{ number: 1, english_word: 'alpha', student_answer: 'a', is_correct: true }])
    expect((await saveVocab(vocabRequest(), params)).status).toBe(422)
    expect(m.rpc).not.toHaveBeenCalled()
    expect(m.upload).not.toHaveBeenCalled()
    expect(m.directWrite).not.toHaveBeenCalled()
  })
  it.each(['upload', 'verify'])('does not commit if photo %s fails', async (stage) => {
    if (stage === 'upload') m.upload.mockResolvedValueOnce({ error: { message: 'quota' } })
    else m.info.mockResolvedValueOnce({ data: null, error: { message: 'missing' } })
    expect((await saveVocab(vocabRequest(), params)).status).toBe(503)
    expect(m.rpc).not.toHaveBeenCalled()
    expect(m.directWrite).not.toHaveBeenCalled()
  })
  it('reports failed transactional writes as errors, never successful grades', async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'write failed' } })
    const response = await saveVocab(vocabRequest(), params)
    expect(response.status).toBe(503)
    expect((await response.json()).ok).not.toBe(true)
    expect(m.directWrite).not.toHaveBeenCalled()
  })
  it('uses totals returned by committed storage, including locked teacher answers', async () => {
    const response = await saveVocab(vocabRequest(), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ vocab_correct: 1, vocab_total: 2, missing_numbers: [] })
    expect(m.events).toEqual(['upload', 'verify', 'commit'])
    expect(m.upload.mock.calls[0][2]).toMatchObject({ upsert: false })
    expect(m.upload.mock.calls[0][0]).toMatch(/^week\/student\/.+/)
    expect(m.directWrite).not.toHaveBeenCalled()
  })
  it('does not grade using missing source data after a read failure', async () => {
    m.failTable = 'vocab_word'
    expect((await saveVocab(vocabRequest(), params)).status).toBe(503)
    expect(m.vocabAI).not.toHaveBeenCalled()
    expect(m.rpc).not.toHaveBeenCalled()
  })
})

it('maps transaction conflicts and invalid input to explicit HTTP failures', () => {
  expect(gradePersistenceStatus('40001')).toBe(409)
  expect(gradePersistenceStatus('42501')).toBe(403)
  expect(gradePersistenceStatus('22023')).toBe(422)
  expect(gradePersistenceStatus('unknown')).toBe(503)
})
