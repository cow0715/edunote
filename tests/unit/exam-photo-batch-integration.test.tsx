// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExamPhotoBatchDialog } from '@/components/grade/exam-photo-batch-dialog'
import type { GradeRow } from '@/hooks/use-grade'
import type { ExamQuestion } from '@/lib/types'
import { PDFDocument } from 'pdf-lib'

vi.mock('@/lib/image-compress', () => ({ compressImageForUpload: vi.fn(async () => ({
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT2QAAAAASUVORK5CYII=',
  mimeType: 'image/png',
})) }))
vi.mock('@/components/grade/mobile-capture', () => ({
  MobileCapture: ({ active, onConfirm }: { active: boolean; onConfirm: (files: File[]) => Promise<void> }) => active ? (
    <button onClick={() => onConfirm([new File(['one'], 'one.jpg', { type: 'image/jpeg' }), new File(['two'], 'two.jpg', { type: 'image/jpeg' })])}>촬영한 두 장 확인 완료</button>
  ) : null,
}))

const students = [
  { student_id: 'a', student_name: '학생 가', present: true, hasExisting: false },
  { student_id: 'b', student_name: '학생 나', present: true, hasExisting: false },
]
let request: ReturnType<typeof vi.fn>
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:photo') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  request = vi.fn()
  vi.stubGlobal('fetch', request)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function confirmAllExamStudents() {
  await waitFor(() => {
    const buttons = screen.getAllByRole('button', { name: /^사진 \d+: .* 학생 확인$/ })
    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true)
  })
  for (const button of screen.getAllByRole('button', { name: /^사진 \d+: .* 학생 확인$/ })) fireEvent.click(button)
}

describe('촬영 확인 → 기존 일괄 처리 연결', () => {
  it('같은 판독 코드의 앞뒷장을 한 학생의 채점 작업과 PDF 한 건으로 연결한다', async () => {
    let nextPage = 2
    const photoPath = 'week/a/job'
    const onFinalize = vi.fn(async () => {})
    const prepareOcr = vi.fn(() => { throw new Error('stop before grading in this test') })
    request.mockImplementation(async (url: string, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body ?? '{}'))
      if (url.endsWith('vocab-photo-name')) {
        expect(body.kind).toBe('reading')
        return Response.json({ studentId: 'a', confidence: 'high', codeMatch: 'matched', sheetPage: nextPage-- })
      }
      if (url.endsWith('exam-photo-job')) {
        if (init.method !== 'POST') return Response.json({ job: null })
        expect(body.studentIds).toEqual(['a'])
        return Response.json({ id: 'job' })
      }
      expect(url).toContain('/ocr-exam-photo')
      expect(body.studentId).toBe('a')
      if (body.storeOnly) {
        expect(body.mimeType).toBe('application/pdf')
        expect((await PDFDocument.load(body.fileData)).getPageCount()).toBe(2)
        return Response.json({ photoPath })
      }
      expect(body.useStored).toBe(true)
      return Response.json({ results: [] })
    })
    render(<ExamPhotoBatchDialog open onOpenChange={vi.fn()} weekId="week" students={students}
      questionCount={2} questions={[]} prepareOcr={prepareOcr} onFinalize={onFinalize} />)
    fireEvent.click(await screen.findByRole('button', { name: '촬영한 두 장 확인 완료' }))
    const confirm = await screen.findByRole('button', { name: '코드 일치 2장 확인' })
    const start = screen.getByRole('button', { name: '1명 답안 인식 및 채점' }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(start.disabled).toBe(false)
    expect(prepareOcr).not.toHaveBeenCalled()
    fireEvent.click(start)
    await waitFor(() => expect(prepareOcr).toHaveBeenCalledExactlyOnceWith('a', [], photoPath))
    expect(onFinalize).not.toHaveBeenCalled()
    const ocrRequests = request.mock.calls.filter(([url]) => url.endsWith('ocr-exam-photo'))
    expect(ocrRequests).toHaveLength(2)
  })

  it('같은 면 두 장에 경고하고 확정 전에 미인식 문항을 표시한다', async () => {
    const onFinalize = vi.fn(async () => {})
    const questions = ['front', 'back'].map((id, index) => ({
      id, question_number: index + 1, question_style: 'objective',
    } as ExamQuestion))
    request.mockImplementation(async (url: string, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body ?? '{}'))
      if (url.endsWith('/vocab-photo-name')) return Response.json({ studentId: 'a', sheetPage: 1 })
      if (url.endsWith('/exam-photo-job')) {
        return Response.json(init.method === 'POST' ? { id: 'job' } : { job: null })
      }
      if (url.endsWith('/ocr-exam-photo')) {
        return Response.json({ photoPath: 'week/a/job', results: [
          { question_number: 1, student_answer: 2 },
          { question_number: 2, student_answer: null },
        ] })
      }
      expect(url).toBe('/api/weeks/week/grade')
      expect(body.preview).toBe(true)
      return Response.json({ rows: body.rows })
    })
    render(<ExamPhotoBatchDialog open onOpenChange={vi.fn()} weekId="week" students={students}
      questionCount={2} expectedPageCount={2} questions={questions} onFinalize={onFinalize}
      prepareOcr={(studentId, _results, path) => ({
        applied: 1,
        row: {
          ...students[0], student_id: studentId, grade_version: { score_id: null, revision: null },
          vocab_correct: null, reading_present: true, reading_correct: null, homework_done: null, memo: '',
          exam_photo_path: path, answers: [{ exam_question_id: 'front', student_answer: 2 }, { exam_question_id: 'back', student_answer: null }],
        },
      })}
    />)
    fireEvent.click(await screen.findByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await confirmAllExamStudents()
    expect(screen.getByText('학생 가 · 2쪽 누락 · 1쪽 중복')).toBeTruthy()
    const start = screen.getByRole<HTMLButtonElement>('button', { name: '1명 답안 인식 및 채점' })
    expect(start.disabled).toBe(true)
    expect(request.mock.calls.some(([url, init]) => url.endsWith('/exam-photo-job') && init?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: '원본을 확인했고 현재 답안지로 계속합니다' }))
    expect(start.disabled).toBe(false)
    fireEvent.click(start)
    expect(await screen.findByText(/1\/2문항 인식/)).toBeTruthy()
    expect(screen.getByText('미인식 · 2번')).toBeTruthy()
    expect(screen.getByRole('link', { name: '원본 보기' })).toBeTruthy()
    expect(onFinalize).not.toHaveBeenCalled()
  })

  it('15장 중 OCR 502가 난 한 장만 새로고침 후 재시도하고 모두 확정한다', async () => {
    const roster = Array.from({ length: 15 }, (_, index) => ({
      student_id: `student-${index + 1}`, student_name: `학생 ${index + 1}`, present: true, hasExisting: false,
    }))
    const failedId = roster[14].student_id
    const makeRow = (studentId: string, photoPath: string): GradeRow => ({
      ...roster.find((student) => student.student_id === studentId)!,
      grade_version: { score_id: null, revision: null },
      vocab_correct: null, reading_present: true, reading_correct: null, homework_done: null, memo: '',
      exam_photo_path: photoPath,
      answers: [{ exam_question_id: 'q1', student_answer: 1, student_answer_text: '' }],
    })
    const job = {
      id: 'retry-job',
      items: roster.map(({ student_id }) => ({
        student_id, photo_path: `week/${student_id}/retry-job`, mime_type: 'image/jpeg',
        ocr_results: null as unknown[] | null, grade_draft: null as GradeRow | null, grade_draft_revision: 0,
      })),
    }
    const ocrCalls: string[] = []
    const gradeCalls: string[][] = []
    const onFinalize = vi.fn<(rows: GradeRow[], jobId: string) => Promise<void>>(async () => {})
    let failOcr = true
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (url.endsWith('exam-photo-job')) {
        expect(init?.method).not.toBe('POST')
        return Response.json({ job })
      }
      if (url.includes('vocab-photo-url')) return Response.json({})
      if (url.endsWith('ocr-exam-photo')) {
        expect(body).toEqual({ jobId: job.id, studentId: expect.any(String), useStored: true })
        ocrCalls.push(body.studentId)
        if (body.studentId === failedId && failOcr) {
          return Response.json({ error: '사진은 저장됐지만 OCR 판독에 실패했습니다.' }, { status: 502 })
        }
        const item = job.items.find((entry) => entry.student_id === body.studentId)!
        item.ocr_results = []
        return Response.json({ results: item.ocr_results })
      }
      expect(url.endsWith('/grade')).toBe(true)
      expect(body).toMatchObject({ preview: true, photoJobId: job.id })
      const rows = body.rows as GradeRow[]
      gradeCalls.push(rows.map((row) => row.student_id))
      for (const row of rows) {
        const item = job.items.find((entry) => entry.student_id === row.student_id)!
        item.grade_draft = row
        item.grade_draft_revision = 1
      }
      return Response.json({ rows })
    })
    const open = async () => {
      const view = render(<ExamPhotoBatchDialog open onOpenChange={vi.fn()} weekId="week"
        students={roster} questionCount={1} questions={[]}
        prepareOcr={(studentId, _results, photoPath) => ({ applied: 1, row: makeRow(studentId, photoPath) })}
        onFinalize={onFinalize} />)
      fireEvent.click(await screen.findByRole('button', { name: '채점 작업 15장 이어서 처리' }))
      return view
    }
    const firstView = await open()
    await screen.findByText('1차 채점 14명 · 사진 처리 실패 1명')
    expect(screen.getByRole('alert').textContent).toContain('OCR 판독에 실패')
    expect(ocrCalls.toSorted()).toEqual(roster.map((student) => student.student_id).toSorted())
    expect(gradeCalls).toHaveLength(1)
    expect(gradeCalls[0]).toHaveLength(14)
    const saved = structuredClone(job.items.slice(0, 14))
    firstView.unmount()

    await open()
    await screen.findByText('1차 채점 14명 · 사진 처리 실패 1명')
    expect(ocrCalls.slice(15)).toEqual([failedId])
    expect(gradeCalls).toHaveLength(1)
    failOcr = false
    fireEvent.click(screen.getByRole('button', { name: '실패 재시도' }))
    fireEvent.click(await screen.findByRole('button', { name: '15명 일괄 확정' }))

    await waitFor(() => expect(onFinalize).toHaveBeenCalledOnce())
    expect(ocrCalls.slice(15)).toEqual([failedId, failedId])
    expect(gradeCalls[1]).toEqual([failedId])
    expect(job.items.slice(0, 14)).toEqual(saved)
    expect(onFinalize).toHaveBeenCalledExactlyOnceWith(job.items.map((item) => item.grade_draft), job.id)
  })

  it('독해는 사진을 먼저 저장하고 검토한 결과를 한 번에 확정한다', async () => {
    const question = { id: 'q1', question_number: 1, question_style: 'subjective', correct_answer_text: '정답' } as ExamQuestion
    const events: string[] = []
    let nameIndex = 0
    let secondUploadAttempts = 0
    let finishPreview: () => void = () => {}
    let finishSecondUpload: () => void = () => {}
    const previewGate = new Promise<void>((resolve) => { finishPreview = resolve })
    const uploadGate = new Promise<void>((resolve) => { finishSecondUpload = resolve })
    request.mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}'))
      if (url.endsWith('exam-photo-job')) {
        if (init.method === 'PATCH') return Response.json({ revision: body.revision + 1 })
        if (init.method !== 'POST') return Response.json({ job: null })
        if (body.closeJobId) return Response.json({ ok: true })
        expect(body.studentIds).toEqual(['a', 'b'])
        return Response.json({ id: 'test-job' })
      }
      if (url.endsWith('vocab-photo-name')) {
        return Response.json({ studentId: students[nameIndex++].student_id, confidence: 'high' })
      }
      if (body.storeOnly) {
        if (body.studentId === 'b' && ++secondUploadAttempts === 1) {
          await uploadGate
          return Response.json({ error: '사진 저장 실패' }, { status: 503 })
        }
        events.push(`store:${body.studentId}`)
        return Response.json({ ok: true, photoPath: `week/${body.studentId}/photo` })
      }
      if (body.useStored) {
        expect(events).toEqual(expect.arrayContaining(['store:a', 'store:b']))
        expect(body.jobId).toBe('test-job')
        events.push(`ocr:${body.studentId}`)
        return Response.json({ ok: true, results: [] })
      }
      expect(body.preview).toBe(true)
      expect(events).toEqual(expect.arrayContaining(['ocr:a', 'ocr:b']))
      await previewGate
      return Response.json({ rows: (body.rows as GradeRow[]).map((row) => ({
        ...row, answers: row.answers.map((answer) => ({
          ...answer, is_correct: answer.student_answer_text === '수정 답안',
          needs_review: row.student_id === 'a' && answer.student_answer_text !== '수정 답안',
        })),
      })) })
    })
    const onFinalize = vi.fn<(rows: GradeRow[]) => Promise<void>>(async () => {})
    render(<ExamPhotoBatchDialog
      open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} questions={[question]}
      prepareOcr={(studentId, _results, photoPath) => ({
        applied: 1,
        row: {
          ...students.find((student) => student.student_id === studentId)!, grade_version: { score_id: null, revision: null },
          vocab_correct: null, reading_present: true, reading_correct: null, homework_done: null, memo: '',
          exam_photo_path: photoPath, answers: [{ exam_question_id: question.id, student_answer: null, student_answer_text: '인식 답안' }],
        },
      })}
      onFinalize={onFinalize}
    />)
    fireEvent.click(await screen.findByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await confirmAllExamStudents()
    fireEvent.click(screen.getByRole('button', { name: '2명 답안 인식 및 채점' }))
    await screen.findByText('사진 저장 1 / 2장')
    expect(events).toEqual(['store:a'])
    finishSecondUpload()
    fireEvent.click(await screen.findByRole('button', { name: '실패 재시도' }))
    await screen.findByRole('heading', { name: '1차 채점 중' })
    expect(screen.getByRole('button', { name: '취소' }).hasAttribute('disabled')).toBe(true)
    expect(onFinalize).not.toHaveBeenCalled()
    finishPreview()
    await screen.findByRole('heading', { name: '서술형 검토' })
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '2명 일괄 확정' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '수정 답안' } })
    await screen.findByText('검토 내용 저장됨')
    expect(request.mock.calls.some(([url, init]) => url.endsWith('exam-photo-job') && init.method === 'PATCH' &&
      JSON.parse(String(init.body)).answers[0].student_answer_text === '수정 답안')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '다시 채점' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '2명 일괄 확정' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '2명 일괄 확정' }))
    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1))
    expect(onFinalize.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ student_id: 'a', exam_photo_path: 'week/a/photo', answers: [
        expect.objectContaining({ student_answer_text: '수정 답안', is_correct: true, needs_review: false }),
      ] }),
    ]))
    expect(events).toHaveLength(4)
  })

})
