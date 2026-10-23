import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ auth: vi.fn(), teacher: vi.fn(), owner: vi.fn(), ocr: vi.fn(), upload: vi.fn(), link: vi.fn(), download: vi.fn(), events: [] as string[] }))
vi.mock('@/lib/api', () => ({ getAuth: m.auth, getTeacherId: m.teacher, assertWeekOwner: m.owner,
  ok: (body: unknown) => Response.json(body), err: (error: string, status = 400) => Response.json({ error }, { status }) }))
vi.mock('@/lib/anthropic', () => ({ ocrExamAnswers: m.ocr }))
import { POST } from '@/app/api/weeks/[id]/ocr-exam-photo/route'

const path = 'week/student'
function query(result: unknown) {
  const q = { select: () => q, eq: () => q, single: async () => result, maybeSingle: async () => result,
    order: async () => result }
  return q
}
beforeEach(() => {
  vi.resetAllMocks()
  m.events.length = 0
  m.teacher.mockResolvedValue('teacher')
  m.owner.mockResolvedValue(true)
  m.upload.mockImplementation(async () => { m.events.push('upload'); return { error: null } })
  m.link.mockImplementation(async () => { m.events.push('link'); return { data: { exam_photo_path: path }, error: null } })
  m.ocr.mockImplementation(async () => { m.events.push('ocr'); return [] })
  m.download.mockResolvedValue({ data: new Blob(['photo'], { type: 'image/jpeg' }), error: null })
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {
    storage: { from: () => ({ upload: m.upload, download: m.download }) },
    from: (table: string) => table === 'week_score'
      ? { upsert: () => ({ select: () => ({ single: m.link }) }) }
      : query({ data: table === 'week' ? { class_id: 'class' } : table === 'class_student' ? { student_id: 'student' }
        : [{ question_number: 1, question_style: 'objective', sub_label: null }], error: null }),
  } })
})
function call(extra: Record<string, unknown> = {}) {
  return POST(new Request('http://localhost/photo', { method: 'POST', body: JSON.stringify({ studentId: 'student', fileData: 'cGhvdG8=', mimeType: 'image/jpeg', ...extra }) }), { params: Promise.resolve({ id: 'week' }) })
}
describe('진단평가 사진 보관을 OCR보다 먼저 확정', () => {
  it('업로드와 학생 연결을 끝낸 뒤에만 OCR을 호출한다', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(m.events).toEqual(['upload', 'link', 'ocr'])
    expect((await response.json()).photoPath).toBe(path)
  })
  it.each(['returned', 'thrown'])('Storage 실패(%s)는 명확한 오류이고 OCR·DB 연결을 하지 않는다', async (mode) => {
    if (mode === 'returned') m.upload.mockResolvedValueOnce({ error: { message: 'quota' } })
    else m.upload.mockRejectedValueOnce(Error('network'))
    const response = await call()
    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain('사진 저장에 실패')
    expect(m.link).not.toHaveBeenCalled()
    expect(m.ocr).not.toHaveBeenCalled()
  })
  it.each(['error', 'empty', 'thrown'])('학생 연결 실패(%s)도 성공으로 처리하지 않는다', async (mode) => {
    if (mode === 'thrown') m.link.mockRejectedValueOnce(Error('database'))
    else m.link.mockResolvedValueOnce({ data: null, error: mode === 'error' ? { message: 'denied' } : null })
    const response = await call()
    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain('파일은 저장됐지만 학생과 연결하지 못')
    expect(m.ocr).not.toHaveBeenCalled()
  })
  it('OCR 실패에도 파일과 DB 연결은 이미 남아 있고 저장됨을 안내한다', async () => {
    m.ocr.mockRejectedValueOnce(Error('OCR timeout'))
    const response = await call()
    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('사진은 저장됐지만')
    expect(m.events).toEqual(['upload', 'link'])
  })
  it('학생이 없으면 보관 없는 판독을 허용하지 않는다', async () => {
    expect((await call({ studentId: null })).status).toBe(400)
    expect(m.upload).not.toHaveBeenCalled()
    expect(m.ocr).not.toHaveBeenCalled()
  })
  it('저장된 사진 재판독은 기존 파일을 덮어쓰지 않는다', async () => {
    expect((await call({ useStored: true })).status).toBe(200)
    expect(m.download).toHaveBeenCalledWith(path)
    expect(m.upload).not.toHaveBeenCalled()
    expect(m.link).not.toHaveBeenCalled()
    expect(m.ocr).toHaveBeenCalledOnce()
  })
})
