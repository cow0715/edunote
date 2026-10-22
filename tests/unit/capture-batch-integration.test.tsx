// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExamBatchGradeDialog } from '@/components/grade/exam-batch-grade-dialog'
import { VocabBatchGradeDialog } from '@/components/grade/vocab-batch-grade-dialog'

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

describe('촬영 확인 → 기존 일괄 처리 연결', () => {
  it('진단평가는 매칭 확인 뒤에만 판독하고 기존 onApplied로 답안을 전달한다', async () => {
    let nameIndex = 0
    request.mockImplementation(async (url: string) => ({ json: async () => url.endsWith('vocab-photo-name')
      ? { studentId: students[nameIndex++].student_id, confidence: 'high' }
      : { ok: true, results: [{ question_number: 1, sub_label: null, student_answer: 3 }] } }))
    const onApplied = vi.fn<(studentId: string) => number>(() => 1)
    render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={onApplied} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    const read = await screen.findByRole('button', { name: '2명 답안 읽기' })
    await waitFor(() => expect(read.hasAttribute('disabled')).toBe(false))
    expect(request.mock.calls.every(([url]) => url.endsWith('vocab-photo-name'))).toBe(true)
    expect(onApplied).not.toHaveBeenCalled()
    fireEvent.click(read)
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(2))
    expect(onApplied.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b'])
    expect(screen.getByText(/채점표에서 답안을 확인하고/)).toBeTruthy()
  })

  it.each(['exam', 'vocab'])('%s: 같은 학생에게 두 장이 매칭되면 처리를 차단한다', async (kind) => {
    request.mockResolvedValue({ json: async () => ({ studentId: 'a', confidence: 'high' }) })
    if (kind === 'exam') render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={vi.fn()} />)
    else render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await waitFor(() => expect(screen.getAllByRole('combobox').every((select) => (select as HTMLSelectElement).value === 'a')).toBe(true))
    const start = screen.getByRole('button', { name: kind === 'exam' ? '2명 답안 읽기' : '2명 채점하기' })
    expect(start.hasAttribute('disabled')).toBe(true)
    // Fix one assignment and the existing workflow becomes available again.
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'b' } })
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('단어 시험은 기존 채점 API와 완료 콜백을 사용한다', async () => {
    let nameIndex = 0
    request.mockImplementation(async (url: string) => ({ json: async () => url.endsWith('vocab-photo-name')
      ? { studentId: students[nameIndex++].student_id, confidence: 'high' }
      : { ok: true, vocab_correct: 9, vocab_total: 10, results: [], missing_numbers: [] } }))
    const onGraded = vi.fn()
    render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={onGraded} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    const start = await screen.findByRole('button', { name: '2명 채점하기' })
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
    fireEvent.click(start)
    await waitFor(() => expect(onGraded).toHaveBeenCalledTimes(2))
    expect(onGraded).toHaveBeenCalledWith('a', 9, 10, [])
    expect(request.mock.calls.filter(([url]) => url.endsWith('grade-vocab-photo'))).toHaveLength(2)
  })
})


describe('단계별 액션과 되돌아가기', () => {
  it('추가 단계에서 중복 업로드창이나 비활성 채점 버튼을 표시하지 않는다', () => {
    render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '답안지 파일 선택' })).toBeNull()
    expect(screen.queryByRole('button', { name: /채점하기/ })).toBeNull()
  })

  it('사진 확인으로 돌아갔다 재확인해도 기존 항목을 중복 추가하지 않는다', async () => {
    let nameIndex = 0
    request.mockImplementation(async () => ({ json: async () => ({ studentId: students[nameIndex++ % 2].student_id, confidence: 'high' }) }))
    render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '2명 답안 읽기' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '사진 확인으로 돌아가기' }))
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '2명 답안 읽기' }).hasAttribute('disabled')).toBe(false))
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('채점 실패 항목만 재시도하고 완료된 학생은 다시 채점하지 않는다', async () => {
    let nameIndex = 0
    let attemptsB = 0
    const onGraded = vi.fn()
    request.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('vocab-photo-name')) return { json: async () => ({ studentId: students[nameIndex++].student_id, confidence: 'high' }) }
      const body = JSON.parse(init.body as string)
      const failed = body.studentId === 'b' && attemptsB++ === 0
      return { json: async () => failed ? { ok: false, error: '일시 오류' } : { ok: true, vocab_correct: 9, vocab_total: 10, results: [], missing_numbers: [] } }
    })
    render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={onGraded} />)
    fireEvent.click(screen.getByRole('button', { name: '촬영한 두 장 확인 완료' }))
    const start = await screen.findByRole('button', { name: '2명 채점하기' })
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false))
    fireEvent.click(start)
    const retry = await screen.findByRole('button', { name: '실패 1건 재시도' })
    expect(onGraded).toHaveBeenCalledTimes(1)
    fireEvent.click(retry)
    await waitFor(() => expect(onGraded).toHaveBeenCalledTimes(2))
    expect(request.mock.calls.filter(([url, init]) => url.endsWith('grade-vocab-photo') && JSON.parse(init.body).studentId === 'a')).toHaveLength(1)
  })
})
