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

it('retains the production add stage without duplicate upload or disabled grade controls',()=>{
 render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={vi.fn()}/>)
 expect(screen.queryByRole('button',{name:'답안지 파일 선택'})).toBeNull()
 expect(screen.queryByRole('button',{name:/채점 시작/})).toBeNull()
})

it('retains production back navigation without appending the same photos a second time',async()=>{
 let index=0
 request.mockImplementation(async()=>({ok:true,json:async()=>({studentId:students[index++%2].student_id,confidence:'high'})}))
 render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} questionCount={1} onApplied={vi.fn(()=>1)}/>)
 fireEvent.click(screen.getByRole('button',{name:'촬영한 두 장 확인 완료'}));await confirmAllExamStudents()
 fireEvent.click(screen.getByRole('button',{name:'사진 확인으로 돌아가기'}))
 fireEvent.click(screen.getByRole('button',{name:'촬영한 두 장 확인 완료'}));await confirmAllExamStudents()
 expect(screen.getAllByRole('combobox')).toHaveLength(2)
 expect(request).toHaveBeenCalledTimes(4)
})

it('retains production retry behavior: already completed students are not graded again',async()=>{
 let nameIndex=0,attempts=0
 request.mockImplementation(async(url:string,init:RequestInit)=>({ok:true,json:async()=>{
  if(url.endsWith('vocab-photo-name'))return {studentId:students[nameIndex++].student_id,confidence:'high'}
  const body=JSON.parse(init.body as string)
  return body.studentId==='b'&&attempts++===0?{ok:false,error:'temporary'}:{ok:true,vocab_correct:1,vocab_total:1,results:[]}
 }}))
 const onGraded=vi.fn()
 render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="week" students={students} onGraded={onGraded}/>)
 fireEvent.click(screen.getByRole('button',{name:'촬영한 두 장 확인 완료'}));await confirmAllExamStudents()
 fireEvent.click(screen.getByRole('button',{name:'2명 채점 시작'}))
 fireEvent.click(await screen.findByRole('button',{name:'실패 1건 재시도'}))
 await waitFor(()=>expect(onGraded).toHaveBeenCalledTimes(2))
 expect(request.mock.calls.filter(([url,init])=>url.endsWith('grade-vocab-photo')&&JSON.parse(init.body).studentId==='a')).toHaveLength(1)
})

async function confirmAllExamStudents() {
  await waitFor(() => {
    const buttons = screen.getAllByRole('button', { name: /^사진 \d+: .* 학생 확인$/ })
    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true)
  })
  for (const button of screen.getAllByRole('button', { name: /^사진 \d+: .* 학생 확인$/ })) fireEvent.click(button)
}

describe('촬영 확인 → 기존 일괄 처리 연결', () => {
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
    expect(screen.getByText(/입력된 답안을 성적표에서 확인하세요/)).toBeTruthy()
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
    const retry = await screen.findByRole('button', { name: /^실패.*재시도$/ })
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

it.each(['exam','vocab'])('%s accepts a matching student regardless of the legacy attendance inclusion flag',async kind=>{
 let index=0
 request.mockResolvedValue({ok:true,json:async()=>({studentId:students[index++].student_id,confidence:'high'})})
 const roster=students.map(student=>({...student,present:false}))
 if(kind==='exam')render(<ExamBatchGradeDialog open onOpenChange={vi.fn()} weekId="absent-exam" students={roster} questionCount={1} onApplied={vi.fn()}/>)
 else render(<VocabBatchGradeDialog open onOpenChange={vi.fn()} weekId="absent-vocab" students={roster} onGraded={vi.fn()}/>)
 fireEvent.click(screen.getByRole('button',{name:'촬영한 두 장 확인 완료'}))
 await waitFor(()=>expect(screen.getAllByRole('combobox').map(element=>(element as HTMLSelectElement).value).sort()).toEqual(['a','b']))
 await confirmAllExamStudents()
 const start=screen.getByRole('button',{name:kind==='exam'?'2명 답안 인식':'2명 채점 시작'})
 expect(start.hasAttribute('disabled')).toBe(false)
 expect(screen.getAllByRole('option',{name:'학생 가'}).every(element=>!(element as HTMLOptionElement).disabled)).toBe(true)
})
