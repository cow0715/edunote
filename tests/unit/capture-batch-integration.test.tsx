// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExamBatchGradeDialog } from '@/components/grade/exam-batch-grade-dialog'
import { VocabBatchGradeDialog } from '@/components/grade/vocab-batch-grade-dialog'
import type { GradeRow } from '@/hooks/use-grade'
import type { ExamQuestion } from '@/lib/types'

vi.mock('@/lib/image-compress', () => ({ compressImageForUpload: vi.fn(async () => ({ base64: 'YQ==', mimeType: 'image/jpeg' })) }))
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
      const view = render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week"
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
    render(<ExamBatchGradeDialog
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

  it.each(['exam', 'vocab'])('%s: 기존 결과도 학생 확인 후 추가 확인창 없이 일괄 처리한다', async (kind) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    let nameIndex = 0
    request.mockImplementation(async (url: string, init: RequestInit) => ({ ok: true, json: async () => url.endsWith('vocab-photo-name')
      ? { studentId: students[nameIndex++].student_id, confidence: 'high' }
      : { ok: true, photoPath: `week/${JSON.parse(init.body as string).studentId}`, results: [], vocab_correct: 1, vocab_total: 1 } }))
    const existing = students.map((student) => ({ ...student, hasExisting: true }))
    if (kind === 'exam') render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={existing} questionCount={1} onApplied={vi.fn(() => 1)} />)
    else render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={existing} onGraded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await confirmAllExamStudents()
    fireEvent.click(screen.getByRole('button', { name: kind === 'exam' ? '2명 답안 인식' : '2명 채점 시작' }))
    await waitFor(() => expect(request.mock.calls.filter(([url]) => url.endsWith(kind === 'exam' ? 'ocr-exam-photo' : 'grade-vocab-photo'))).toHaveLength(2))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
  it('일괄 판독 성공 응답에 사진 경로가 없으면 답안 반영을 막는다', async () => {
    let nameIndex = 0
    request.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('vocab-photo-name')
      ? { studentId: students[nameIndex++].student_id, confidence: 'high' }
      : { ok: true, results: [] } }))
    const onApplied = vi.fn()
    render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={onApplied} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    const read = await screen.findByRole('button', { name: '2명 답안 인식' })
    await confirmAllExamStudents()
    await waitFor(() => expect(read.hasAttribute('disabled')).toBe(false))
    fireEvent.click(read)
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(onApplied).not.toHaveBeenCalled()
  })
  it('일괄 판독에서도 사진 저장 실패를 알리고 답안 반영을 막는다', async () => {
    let nameIndex = 0
    request.mockImplementation(async (url: string) => ({ ok: url.endsWith('vocab-photo-name'), json: async () => url.endsWith('vocab-photo-name')
      ? { studentId: students[nameIndex++].student_id, confidence: 'high' }
      : { error: '답안지 사진 저장에 실패했습니다. 판독을 시작하지 않았습니다.' } }))
    const onApplied = vi.fn()
    render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={onApplied} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    const read = await screen.findByRole('button', { name: '2명 답안 인식' })
    await confirmAllExamStudents()
    await waitFor(() => expect(read.hasAttribute('disabled')).toBe(false))
    fireEvent.click(read)
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(onApplied).not.toHaveBeenCalled()
  })
  it('진단평가는 매칭 확인 뒤에만 판독하고 기존 onApplied로 답안을 전달한다', async () => {
    let nameIndex = 0
    request.mockImplementation(async (url: string, init: RequestInit) => ({ ok: true, json: async () => url.endsWith('vocab-photo-name')
      ? { studentId: students[nameIndex++].student_id, confidence: 'high' }
      : { ok: true, photoPath: `week/${JSON.parse(init.body as string).studentId}`, results: [{ question_number: 1, sub_label: null, student_answer: 3 }] } }))
    const onApplied = vi.fn<(studentId: string) => number>(() => 1)
    render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={onApplied} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    const read = await screen.findByRole('button', { name: '2명 답안 인식' })
    expect(read.hasAttribute('disabled')).toBe(true)
    expect(request.mock.calls.every(([url]) => url.endsWith('vocab-photo-name'))).toBe(true)
    await confirmAllExamStudents()
    await waitFor(() => expect(read.hasAttribute('disabled')).toBe(false))
    expect(request.mock.calls.every(([url]) => url.endsWith('vocab-photo-name'))).toBe(true)
    expect(onApplied).not.toHaveBeenCalled()
    fireEvent.click(read)
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(2))
    expect(onApplied.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b'])
    expect(screen.getByText(/답안을 검토한 후 채점을 저장/)).toBeTruthy()
  })

  it.each(['exam', 'vocab'])('%s: 같은 학생에게 두 장이 매칭되면 처리를 차단한다', async (kind) => {
    request.mockResolvedValue({ json: async () => ({ studentId: 'a', confidence: 'high' }) })
    if (kind === 'exam') render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={vi.fn()} />)
    else render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await waitFor(() => expect(screen.getAllByRole('combobox').every((select) => (select as HTMLSelectElement).value === 'a')).toBe(true))
    const start = screen.getByRole('button', { name: kind === 'exam' ? '2명 답안 인식' : '2명 채점 시작' })
    expect(start.hasAttribute('disabled')).toBe(true)
    // Fix one assignment and the existing workflow becomes available again.
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'b' } })
    expect(start.hasAttribute('disabled')).toBe(true)
    await confirmAllExamStudents()
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['exam', 'vocab'])('%s: 두 이름이 서로 반대로 자동 연결돼도 사진마다 확인하기 전에는 진행하지 않는다', async (kind) => {
    let index = 0
    request.mockResolvedValue({ ok: true, json: async () => ({ studentId: students[1 - index++].student_id, confidence: 'high' }) })
    if (kind === 'exam') render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={vi.fn()} />)
    else render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await waitFor(() => expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('b'))
    const start = screen.getByRole('button', { name: kind === 'exam' ? '2명 답안 인식' : '2명 채점 시작' })
    expect(start.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'a' } })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'b' } })
    fireEvent.click(screen.getByRole('button', { name: '사진 1: 학생 가 학생 확인' }))
    expect(start.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '사진 2: 학생 나 학생 확인' }))
    expect(start.hasAttribute('disabled')).toBe(false)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['exam', 'vocab'])('%s: 확인한 사진의 학생을 변경하면 확인이 해제되고 다시 확인해야 한다', async (kind) => {
    let index = 0
    request.mockResolvedValue({ ok: true, json: async () => ({ studentId: students[index++].student_id, confidence: 'high' }) })
    if (kind === 'exam') render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={vi.fn()} />)
    else render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await confirmAllExamStudents()
    const start = screen.getByRole('button', { name: kind === 'exam' ? '2명 답안 인식' : '2명 채점 시작' })
    expect(start.hasAttribute('disabled')).toBe(false)
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '' } })
    expect(start.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'a' } })
    expect(start.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '사진 1: 학생 가 학생 확인' }))
    expect(start.hasAttribute('disabled')).toBe(false)
  })

  it.each(['exam', 'vocab'])('%s: 학생을 못 읽은 사진을 자동으로 제외하고 나머지만 진행하지 않는다', async (kind) => {
    let index = 0
    request.mockResolvedValue({ ok: true, json: async () => ({ studentId: index++ === 0 ? 'a' : null, confidence: 'none' }) })
    if (kind === 'exam') render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={vi.fn()} />)
    else render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    fireEvent.click(await screen.findByRole('button', { name: '사진 1: 학생 가 학생 확인' }))
    expect(screen.getByRole('button', { name: kind === 'exam' ? /답안 인식/ : /채점 시작/ }).hasAttribute('disabled')).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['exam', 'vocab'])('%s: 실패한 사진의 학생을 바꾸면 재시도도 다시 확인할 때까지 잠긴다', async (kind) => {
    let index = 0
    request.mockImplementation(async (url: string) => ({ ok: url.endsWith('vocab-photo-name'), json: async () => url.endsWith('vocab-photo-name')
      ? { studentId: students[index++].student_id, confidence: 'high' }
      : { error: '판독 실패' } }))
    if (kind === 'exam') render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={vi.fn()} />)
    else render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await confirmAllExamStudents()
    fireEvent.click(screen.getByRole('button', { name: kind === 'exam' ? '2명 답안 인식' : '2명 채점 시작' }))
    const retry = await screen.findByRole('button', { name: kind === 'exam' ? '실패 재시도' : '실패 2건 재시도' })
    expect(retry.hasAttribute('disabled')).toBe(false)
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '' } })
    expect(retry.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'a' } })
    expect(retry.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '사진 1: 학생 가 학생 확인' }))
    expect(retry.hasAttribute('disabled')).toBe(false)
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('단어 시험은 기존 채점 API와 완료 콜백을 사용한다', async () => {
    let nameIndex = 0
    request.mockImplementation(async (url: string) => ({ json: async () => url.endsWith('vocab-photo-name')
      ? { studentId: students[nameIndex++].student_id, confidence: 'high' }
      : { ok: true, vocab_correct: 9, vocab_total: 10, results: [], missing_numbers: [] } }))
    const onGraded = vi.fn()
    render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={onGraded} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    const start = await screen.findByRole('button', { name: '2명 채점 시작' })
    expect(start.hasAttribute('disabled')).toBe(true)
    await confirmAllExamStudents()
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
    fireEvent.click(start)
    await waitFor(() => expect(onGraded).toHaveBeenCalledTimes(2))
    expect(onGraded).toHaveBeenCalledWith('a', 9, 10, [])
    expect(request.mock.calls.filter(([url]) => url.endsWith('grade-vocab-photo'))).toHaveLength(2)
  })
})
