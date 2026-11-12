import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseServerClient } from '@/lib/api'
import { assertGradePhotosAvailable, requireExamPhotoPath } from '@/lib/exam-photo'

const m = vi.hoisted(() => ({ auth: vi.fn(), teacher: vi.fn(), owner: vi.fn() }))
vi.mock('@/lib/api', () => ({ getAuth: m.auth, getTeacherId: m.teacher, assertWeekOwner: m.owner,
  ok: (body: unknown) => Response.json(body), err: (error: string, status = 400) => Response.json({ error }, { status }) }))
vi.mock('@/lib/anthropic', () => ({ gradeSubjectiveAnswers: vi.fn() }))
import { POST } from '@/app/api/weeks/[id]/grade/route'

const row = { student_id: 'student', present: true, reading_present: true, exam_photo_path: 'week/student' }
let info: ReturnType<typeof vi.fn>
let write: ReturnType<typeof vi.fn>
let client: SupabaseServerClient
let scores: { student_id: string; exam_photo_path: string | null }[]
let lookupError: { message: string } | null

beforeEach(() => {
  vi.clearAllMocks()
  scores = [{ student_id: 'student', exam_photo_path: 'week/student' }]
  lookupError = null
  info = vi.fn(async () => ({ data: { size: 100 }, error: null }))
  write = vi.fn(() => { throw new Error('unexpected write') })
  client = {
    storage: { from: () => ({ info }) },
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: scores, error: lookupError }) }) }), upsert: write, delete: write }),
  } as unknown as SupabaseServerClient
  m.auth.mockResolvedValue({ supabase: client, user: { id: 'user' } })
  m.teacher.mockResolvedValue('teacher')
  m.owner.mockResolvedValue(true)
})

describe('사진 판독 결과와 저장된 사진의 연결', () => {
  it('사진 저장 경로는 해당 주차와 학생에 일치해야 한다', () => {
    for (const value of [undefined, null, '', 'other/student', 'week/other']) {
      expect(() => requireExamPhotoPath('week', 'student', value)).toThrow()
    }
    expect(requireExamPhotoPath('week', 'student', row.exam_photo_path)).toBe(row.exam_photo_path)
    expect(requireExamPhotoPath('week', 'student', 'week/student/new-photo')).toBe('week/student/new-photo')
    for (const path of ['week/student/../other', 'week/student/', 'week/student/new/file', 'week/other/new-photo']) {
      expect(() => requireExamPhotoPath('week', 'student', path)).toThrow()
    }
  })
  it('새 촬영 파일은 학생별 경로와 파일을 확인한 뒤 답안 트랜잭션에서 연결할 수 있다', async () => {
    scores = []
    await expect(assertGradePhotosAvailable(client, 'week', [{ ...row, exam_photo_path: 'week/student/new-photo' }])).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith('week/student/new-photo')
  })
  it('사진 경로와 실제 파일이 일치하면 통과한다', async () => {
    await expect(assertGradePhotosAvailable(client, 'week', [row])).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith('week/student')
  })
  it('사진을 사용하지 않은 수동·과거 답안은 계속 저장할 수 있다', async () => {
    scores = []
    await expect(assertGradePhotosAvailable(client, 'week', [{ ...row, exam_photo_path: null }])).resolves.toBeUndefined()
    expect(info).not.toHaveBeenCalled()
  })
  it('과거 사진이 없어도 새 사진 판독을 하지 않은 기존 답안 편집은 막지 않는다', async () => {
    info.mockResolvedValueOnce({ data: null, error: null } as never)
    await expect(assertGradePhotosAvailable(client, 'week', [{ ...row, exam_photo_path: undefined }])).resolves.toBeUndefined()
    expect(info).not.toHaveBeenCalled()
  })
  it('사진 판독을 하지 않았다면 사진 조회 장애도 수동 입력 저장을 막지 않는다', async () => {
    lookupError = { message: 'database offline' }
    await expect(assertGradePhotosAvailable(client, 'week', [{ ...row, exam_photo_path: null }])).resolves.toBeUndefined()
    expect(info).not.toHaveBeenCalled()
  })
  it('학생 연결이 사라진 사진 답안은 임의로 수동 입력 취급하지 않는다', async () => {
    scores = []
    await expect(assertGradePhotosAvailable(client, 'week', [row])).rejects.toThrow('학생의 연결')
    expect(info).not.toHaveBeenCalled()
  })
  it('사진 조회 실패는 수동 답안으로 추정하지 않고 중단한다', async () => {
    lookupError = { message: 'database offline' }
    await expect(assertGradePhotosAvailable(client, 'week', [row])).rejects.toThrow('사진 연결 정보')
  })
  it.each([true, false])('사진 파일이 없으면 임시저장(%s)·채점 모두 어떤 학생도 변경하기 전에 중단한다', async (skip_ai) => {
    info.mockResolvedValueOnce({ data: null, error: null } as never)
    const response = await POST(new Request('http://localhost/grade', { method: 'POST', body: JSON.stringify({
      rows: [{ ...row, student_id: 'absent', present: false }, row], skip_ai,
    }) }), { params: Promise.resolve({ id: 'week' }) })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('사진 파일')
    expect(write).not.toHaveBeenCalled()
  })

  it('1차 채점은 학생 기록을 쓰지 않고 판정만 반환한다', async () => {
    m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {
      storage: { from: () => ({ info }) },
      from: (table: string) => table === 'exam_question'
        ? { select: () => ({ eq: async () => ({ data: [{ id: 'q1', question_style: 'objective', correct_answer: 2 }], error: null }) }) }
        : client.from(table),
      rpc: write,
    } })
    const response = await POST(new Request('http://localhost/grade', { method: 'POST', body: JSON.stringify({
      preview: true,
      rows: [{ ...row, grade_version: { score_id: null, revision: null },
        answers: [{ exam_question_id: 'q1', student_answer: 2 }] }],
    }) }), { params: Promise.resolve({ id: 'week' }) })

    expect(response.status).toBe(200)
    expect((await response.json()).rows[0].answers[0]).toMatchObject({ is_correct: true, needs_review: false })
    expect(write).not.toHaveBeenCalled()
  })
})
