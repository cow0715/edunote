import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ auth: vi.fn(), teacher: vi.fn(), owner: vi.fn(), ocr: vi.fn(), upload: vi.fn(), link: vi.fn(), download: vi.fn(), info: vi.fn(), events: [] as string[] }))
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
  m.info.mockResolvedValue({ data: { size: 5 }, error: null })
  m.auth.mockResolvedValue({ user: { id: 'user' }, supabase: {
    storage: { from: () => ({ upload: m.upload, download: m.download, info: m.info }) },
    from: (table: string) => table === 'week_score'
      ? { ...query({ data: { exam_photo_path: path }, error: null }), upsert: m.link }
      : query({ data: table === 'week' ? { class_id: 'class' } : table === 'class_student' ? { student_id: 'student' }
        : [{ question_number: 1, question_style: 'objective', sub_label: null }], error: null }),
  } })
})
function call(extra: Record<string, unknown> = {}) {
  return POST(new Request('http://localhost/photo', { method: 'POST', body: JSON.stringify({ studentId: 'student', fileData: 'cGhvdG8=', mimeType: 'image/jpeg', ...extra }) }), { params: Promise.resolve({ id: 'week' }) })
}
describe('진단평가 사진 보관을 OCR보다 먼저 확정', () => {
  it('새 사진 보관을 확인한 뒤 OCR을 호출하고 기존 학생 연결은 바꾸지 않는다', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(m.events).toEqual(['upload', 'ocr'])
    expect((await response.json()).photoPath).toMatch(/^week\/student\/[a-zA-Z0-9-]+$/)
  })
  it('keeps the original photo when a retake OCR fails', async () => {
    const stored = new Map<string, string>()
    m.upload.mockImplementation(async (key: string, bytes: Buffer) => {
      stored.set(key, bytes.toString())
      return { error: null }
    })
    expect((await call({ fileData: Buffer.from('old-photo').toString('base64') })).status).toBe(200)
    m.ocr.mockRejectedValueOnce(Error('retake OCR failed'))
    expect((await call({ fileData: Buffer.from('new-photo').toString('base64') })).status).toBe(502)
    expect(stored.size).toBe(2)
    expect([...stored.values()]).toEqual(['old-photo', 'new-photo'])
    expect(m.upload.mock.calls[1][2]).toMatchObject({ upsert: false })
    expect(m.link).not.toHaveBeenCalled()
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
  it('OCR 실패에도 새 파일은 보관하되 기존 답안과 사진 연결은 유지한다', async () => {
    m.ocr.mockRejectedValueOnce(Error('OCR timeout'))
    const response = await call()
    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('사진은 저장됐지만')
    expect(m.events).toEqual(['upload'])
  })
  it.each(['missing', 'empty', 'thrown'])('업로드 응답이 성공해도 실제 파일 확인 실패(%s)는 판독을 막는다', async (mode) => {
    if (mode === 'thrown') m.info.mockRejectedValueOnce(Error('network'))
    else m.info.mockResolvedValueOnce({ data: mode === 'empty' ? { size: 0 } : null, error: null })
    expect((await call()).status).toBe(503)
    expect(m.ocr).not.toHaveBeenCalled()
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
