// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SubjectiveReviewPanel } from '@/components/grade/subjective-review-panel'
import type { ExamQuestion } from '@/lib/types'
import type { GradeRow } from '@/hooks/use-grade'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// 운영 회귀: 예전 검토 버튼은 토글(첫 클릭 = 무조건 정답)이라
// ⚠️ 를 치우다 OCR 깨진 답까지 전부 정답 확정되는 사고가 있었다.
// 이제 정답/오답 버튼이 분리돼 첫 클릭이 그대로 판정이 된다.

function makeQuestion(): ExamQuestion {
  return {
    id: 'q1', week_id: 'w', question_number: 4, sub_label: null, question_type: null,
    question_text: null, question_stem: null, passage: null, choices: null,
    correct_answer: 0, correct_answer_text: '모범답안 문장', extra_correct_answers: [],
    grading_criteria: null, explanation: null, needs_source_image: false, source_image_reason: null,
    source_page: null, source_bbox: null, source_image_path: null, exam_type: 'reading',
    question_style: 'subjective', is_void: false, all_correct: false, created_at: '',
  }
}

function makeRow(studentId: string, name: string, answer: {
  text: string; is_correct?: boolean; needs_review?: boolean
}): GradeRow {
  return {
    student_id: studentId, student_name: name, present: true,
    vocab_correct: null, reading_present: true, reading_correct: null,
    homework_done: null, memo: '',
    answers: [{
      exam_question_id: 'q1',
      student_answer: null,
      student_answer_text: answer.text,
      is_correct: answer.is_correct,
      needs_review: answer.needs_review ?? false,
      teacher_confirmed: false,
      ai_feedback: '',
    }],
  }
}

function renderPanel(rows: GradeRow[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SubjectiveReviewPanel weekId="week-1" questions={[makeQuestion()]} rows={rows} />
    </QueryClientProvider>,
  )
}

describe('SubjectiveReviewPanel — 판정 버튼 분리', () => {
  const rows = [
    makeRow('s1', '검토학생', { text: '깨진 OCR 답', is_correct: false, needs_review: true }),
    makeRow('s2', '정답학생', { text: '모범답안 문장', is_correct: true }),
  ]

  it('검토 대기 건이 있으면 "검토 필요만" 필터가 기본 — 정답 처리된 학생은 숨는다', () => {
    renderPanel(rows)
    expect(screen.getByText('검토학생')).toBeTruthy()
    expect(screen.queryByText('정답학생')).toBeNull()
    expect(screen.getByText('검토 대기 1건')).toBeTruthy()
  })

  it('"전체" 칩을 누르면 모든 학생이 보인다', () => {
    renderPanel(rows)
    fireEvent.click(screen.getByRole('button', { name: '전체' }))
    expect(screen.getByText('검토학생')).toBeTruthy()
    expect(screen.getByText('정답학생')).toBeTruthy()
  })

  it('⚠️ 답의 "✗ 오답" 첫 클릭이 오답으로 저장된다 (예전 토글은 무조건 정답이었다)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    renderPanel(rows)

    fireEvent.click(screen.getByRole('button', { name: '오답' }))
    fireEvent.click(screen.getByRole('button', { name: '검토 완료 저장 (1건)' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual([{ student_id: 's1', exam_question_id: 'q1', is_correct: false }])
  })

  it('"✓ 정답" 클릭은 정답으로 저장된다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    renderPanel(rows)

    fireEvent.click(screen.getByRole('button', { name: '정답' }))
    fireEvent.click(screen.getByRole('button', { name: '검토 완료 저장 (1건)' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual([{ student_id: 's1', exam_question_id: 'q1', is_correct: true }])
  })

  it('같은 버튼을 다시 누르면 판정이 해제된다', () => {
    renderPanel(rows)
    const wrongButton = screen.getByRole('button', { name: '오답' })
    fireEvent.click(wrongButton)
    expect(screen.getByRole('button', { name: '검토 완료 저장 (1건)' })).toBeTruthy()
    fireEvent.click(wrongButton)
    expect(screen.getByRole('button', { name: '변경 없음' })).toBeTruthy()
  })

  it('판정해도 행 순서가 고정된다 — 정렬은 저장 전 원본 상태 기준', () => {
    // 예전엔 판정 반영 상태로 정렬해서, ⚠️ 를 정답 처리하는 순간(우선순위 0→2)
    // 행이 오답 학생(1) 아래로 튀며 목록이 재배열됐다.
    renderPanel([
      makeRow('s1', '검토학생', { text: '애매한 답', is_correct: false, needs_review: true }),
      makeRow('s2', '오답학생', { text: '틀린 답', is_correct: false }),
    ])
    fireEvent.click(screen.getByRole('button', { name: '전체' }))

    const rowNames = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(rowNames()).toEqual(['검토학생', '오답학생'])

    const reviewRow = screen.getAllByRole('row').find((r) => r.textContent?.includes('검토학생'))!
    fireEvent.click(within(reviewRow).getByRole('button', { name: '정답' }))

    expect(rowNames()).toEqual(['검토학생', '오답학생'])
    expect(screen.getByRole('button', { name: '검토 완료 저장 (1건)' })).toBeTruthy()
  })

  it('검토 대기가 없으면 전체 보기가 기본이다', () => {
    renderPanel([makeRow('s2', '정답학생', { text: '모범답안 문장', is_correct: true })])
    expect(screen.getByText('정답학생')).toBeTruthy()
    expect(screen.queryByText('검토 대기 1건')).toBeNull()
  })
})
