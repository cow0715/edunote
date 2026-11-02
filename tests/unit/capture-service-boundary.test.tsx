// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GradeGrid } from '@/components/grade/grade-grid'
import { CaptureRuntimeProvider, useCaptureRuntime, type CaptureRuntime } from '@/components/grade/capture-runtime'
import { captureDraft, type CapturePhoto } from '@/lib/capture-draft'
import { ExamPhotoButton } from '@/components/grade/exam-photo-button'
import { VocabPhotoButton } from '@/components/grade/vocab-photo-button'
import type { GradeRow } from '@/hooks/use-grade'
import type { ExamQuestion } from '@/lib/types'

vi.mock('@/lib/capture-draft', () => ({ captureDraft: vi.fn() }))
vi.mock('@/lib/image-compress', () => ({ compressImageForUpload: vi.fn(async (file: File) => ({
  base64: btoa(file.name), mimeType: 'image/jpeg', originalBytes: 1, bytes: 1, width: 1, height: 1,
})) }))
const notice = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: notice }))

const week = 'ordinary-week'
const students = [{ student_id: 'student-a', student: { name: '학생 가' } }, { student_id: 'student-b', student: { name: '학생 나' } }]
const questions: ExamQuestion[] = [1, 2].map((number) => ({
  id: `question-${number}`, week_id: week, question_number: number, sub_label: null,
  question_type: null, question_text: null, question_stem: null, passage: null, choices: null,
  correct_answer: 3, correct_answer_text: null, extra_correct_answers: [], grading_criteria: null, explanation: null,
  needs_source_image: false, source_image_reason: null, source_page: null, source_bbox: null, source_image_path: null,
  exam_type: 'reading', question_style: 'objective', is_void: false, all_correct: false, created_at: '',
}))
type Score = { id: string; student_id: string; grade_revision: number; vocab_correct: number; reading_correct: number;
  homework_done: null; memo: string; exam_photo_path?: string; vocab_photo_path?: string;
  student_answer: GradeRow['answers']; student_vocab_answer: Record<string, unknown>[] }
const token = (studentId: string) => ({score_id:null,revision:(scores.find(s=>s.student_id===studentId)?.grade_revision ?? 1).toString(16).padStart(64,'0')})
let scores: Score[]
let requests: { url: string; body: Record<string, unknown>; method: string }[]
let clients: QueryClient[] = []

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  questions[1].question_style = 'objective'
  scores = students.map((student) => ({ id: `score-${student.student_id}`, student_id: student.student_id,
    grade_revision: 1, vocab_correct: 0, reading_correct: 0, homework_done: null, memo: '', student_answer: [], student_vocab_answer: [] }))
  requests = []
  const drafts = new Map<string, CapturePhoto[]>()
  vi.mocked(captureDraft).mockImplementation(async (key, photos) => {
    if (photos !== undefined) drafts.set(key, photos)
    return drafts.get(key) ?? []
  })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:ordinary') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET'
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    requests.push({ url, method, body })
    if (url.startsWith('/api/vocab-photo-url?')) return Response.json({ url: 'data:image/png;base64,YQ==' })
    if (url === `/api/weeks/${week}/grade` && method === 'GET') return Response.json({
      grade_versions:students.map(s=>({student_id:s.student_id,...token(s.student_id)})), classStudents: students, weekScores: scores, questions, attendance: [], vocabWords: [],
    })
    if (url === `/api/weeks/${week}/vocab-photo-name`) {
      const id = atob(String(body.fileData)).startsWith('a') ? 'student-a' : 'student-b'
      return Response.json({ studentId: id, rawName: id === 'student-a' ? '학생 가' : '학생 나', confidence: 'high' })
    }
    if (url === `/api/weeks/${week}/ocr-exam-photo`) return Response.json({ ok: true,
      photoPath: `${week}/${body.studentId}/ordinary-photo`,
      results: [1, 2].map((n) => ({ question_number: n, sub_label: null, student_answer: 3 })),
    })
    if (url === `/api/weeks/${week}/grade-vocab-photo`) {
      const score = scores.find((entry) => entry.student_id === body.studentId)!
      score.vocab_correct = 2; score.grade_revision++; score.vocab_photo_path = `${week}/${score.student_id}/ordinary-photo`
      return Response.json({ ok: true, vocab_correct: 2, vocab_total: 3, results: [], missing_numbers: [] })
    }
    if (url === `/api/weeks/${week}/grade` && method === 'POST') {
      const rows = body.rows as GradeRow[]
      if (rows.some((row) => token(row.student_id).revision !== row.grade_version.revision)) {
        return Response.json({ error: 'stale version' }, { status: 409 })
      }
      for (const row of rows) {
        const score = scores.find((entry) => entry.student_id === row.student_id)!
        score.grade_revision++
        score.student_answer = row.answers.map((answer) => ({ ...answer, is_correct: answer.student_answer === 3, teacher_confirmed: false, needs_review: false }))
        score.reading_correct = score.student_answer.filter((answer) => answer.is_correct).length
        if (row.exam_photo_path) score.exam_photo_path = row.exam_photo_path
      }
      return Response.json({ ok: true, versions: rows.map((row) => {
        const score = scores.find((entry) => entry.student_id === row.student_id)!
        return {student_id:score.student_id,...token(score.student_id)}
      }) })
    }
    throw Error(`Unexpected ordinary-service request: ${method} ${url}`)
  }))
})
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients = []; vi.unstubAllGlobals() })

it.each(['reading', 'vocab'])('%s ordinary individual capture still opens the native file picker', (kind) => {
  const { container } = render(kind === 'reading'
    ? <ExamPhotoButton weekId={week} studentId="student-a" disabled={false} onResult={vi.fn()} />
    : <VocabPhotoButton weekId={week} studentId="student-a" disabled={false} hasExistingData onResult={vi.fn()} />)
  const input = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
  const choose = vi.spyOn(input, 'click').mockImplementation(() => {})
  fireEvent.click(screen.getByRole('button',{name:kind==='reading'?'사진 선택':'파일로 재채점'}))
  expect(choose).toHaveBeenCalledOnce()
  expect(requests).toHaveLength(0)
})

it.each(['reading-batch', 'vocab-batch', 'reading-single', 'vocab-single', 'reading-single-ai'])('%s uses ordinary capture/API/save without a sample provider', async (kind) => {
  const reading = kind.startsWith('reading'), batch = kind.endsWith('batch')
  const ai = kind.endsWith('-ai')
  if (ai) questions[1].question_style = 'subjective'
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  render(<QueryClientProvider client={client}><GradeGrid weekId={week} readingTotal={2} vocabTotal={3} homeworkTotal={0} /></QueryClientProvider>)
  await waitFor(() => expect(within(screen.getByRole('table')).getByRole('button', { name: '학생 가 시험 답안 열기' })).toBeTruthy())
  if (batch) {
    fireEvent.click(screen.getByRole('button', { name: reading ? '시험 답안 올리기' : '단어 시험지 채점' }))
    const dialog = screen.getByRole('dialog')
    const picker = dialog.querySelector<HTMLInputElement>('input[aria-label="파일 추가"]')!
    fireEvent.change(picker, { target: { files: [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })] } })
    await screen.findByText(/2장 기기에 보관됨/)
    fireEvent.click(screen.getByText('2장 학생 확인', { selector: 'button' }))
    const first = await screen.findByLabelText('사진 1: 학생 가 학생 확인') as HTMLButtonElement
    await waitFor(() => expect(first.disabled).toBe(false))
    expect(requests.some((entry) => /ocr-exam-photo|grade-vocab-photo/.test(entry.url))).toBe(false)
    fireEvent.click(first)
    fireEvent.click(screen.getByLabelText('사진 2: 학생 나 학생 확인'))
    fireEvent.click(screen.getByText(reading ? '2명 답안 인식' : '2명 채점 시작', { selector: 'button' }))
    const close = await screen.findByText('닫기', { selector: 'button' })
    if (reading) await waitFor(() => expect(requests.filter((entry) => entry.body.skip_ai === true)).toHaveLength(2))
    fireEvent.click(close)
    expect(vi.mocked(captureDraft).mock.calls.some(([key]) => key === `${reading ? 'exam' : 'vocab'}:${week}`)).toBe(true)
  } else {
    const studentRow = within(screen.getByRole('table')).getByRole('button', {name:'학생 가 시험 답안 열기'}).closest('tr')!
    fireEvent.click(within(studentRow).getByRole('button', { name: reading ? '학생 가 시험 답안 열기' : '학생 가 단어 답안 열기' }))
    const dialog = screen.getByRole('dialog')
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(description?.textContent).toBe(reading
      ? '독해 답안을 확인하고 사진으로 판독할 수 있습니다.'
      : '단어 답안을 확인하고 사진으로 채점할 수 있습니다.')
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'a.jpg', { type: 'image/jpeg' })] } })
    await screen.findByText('원본 사진', { selector: 'button' })
    expect(screen.queryByText('학생 확인', { selector: 'button' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    if (reading) await waitFor(() => expect(requests.some((entry) => entry.body.skip_ai === true)).toBe(true))
  }
  if (reading) {
    await waitFor(() => expect(scores[0].reading_correct).toBe(2))
    if (ai) {
      fireEvent.click(screen.getByRole('button',{name:'AI 채점'}))
      await waitFor(() => expect(notice.success).toHaveBeenCalledWith('채점이 저장되었습니다'))
      expect(requests.some((entry) => entry.body.skip_ai === false)).toBe(true)
    }
    await waitFor(() => expect(within(screen.getByRole('table')).getByRole('button',{name:'학생 가 시험 답안 열기'}).textContent?.replace(/\s/g,'')).toContain('2/2'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(scores[0].exam_photo_path).toBe(`${week}/student-a/ordinary-photo`)
  } else {
    await waitFor(() => expect(scores[0].vocab_correct).toBe(2))
    expect(scores[0].vocab_photo_path).toBe(`${week}/student-a/ordinary-photo`)
  }
  expect(notice.error).not.toHaveBeenCalled()
  expect(requests.every((entry) => !entry.url.includes('sample-week'))).toBe(true)
})

it('scopes fake I/O to its provider and restores ordinary I/O after unmount', async () => {
  const fake = vi.fn<typeof fetch>(async () => Response.json({ fake: true }))
  const transport = vi.fn<typeof fetch>(async () => Response.json({ ordinary: true }))
  vi.stubGlobal('fetch', transport)
  function Probe({ name }: { name: string }) {
    const runtime = useCaptureRuntime()
    return <button onClick={() => { void runtime.request(`/${name}`) }}>{name}</button>
  }
  const sample: CaptureRuntime = { request: fake, compress: vi.fn(), draft: vi.fn() }
  const { rerender } = render(<><CaptureRuntimeProvider value={sample}><Probe name="inside" /></CaptureRuntimeProvider><Probe name="outside" /></>)
  fireEvent.click(screen.getByText('inside'))
  fireEvent.click(screen.getByText('outside'))
  expect(fake).toHaveBeenCalledExactlyOnceWith('/inside')
  expect(transport).toHaveBeenCalledExactlyOnceWith('/outside')
  rerender(<Probe name="ordinary again" />)
  fireEvent.click(screen.getByText('ordinary again'))
  expect(fake).toHaveBeenCalledTimes(1)
  expect(transport).toHaveBeenLastCalledWith('/ordinary again')
})
