// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { ExamSheetContent } from '@/components/grade/exam-sheet-content'
import type { ExamQuestion } from '@/lib/types'
import type { GradeRow } from '@/hooks/use-grade'

afterEach(cleanup)

// OCR 버튼 등 fetch 를 쓰는 자식은 실제 렌더만 되면 된다
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })))

function q(partial: Partial<ExamQuestion> & { id: string; question_number: number }): ExamQuestion {
  return {
    week_id: 'w1',
    sub_label: null,
    question_type: null,
    question_text: null,
    question_stem: null,
    passage: null,
    choices: null,
    correct_answer: 0,
    correct_answer_text: null,
    extra_correct_answers: [],
    grading_criteria: null,
    explanation: null,
    needs_source_image: false,
    source_image_reason: null,
    source_page: null,
    source_bbox: null,
    source_image_path: null,
    exam_type: 'reading',
    question_style: 'objective',
    is_void: false,
    all_correct: false,
    created_at: '',
    ...partial,
  }
}

function row(answers: GradeRow['answers']): GradeRow {
  return {
    student_id: 's1',
    student_name: '홍길동',
    present: true,
    vocab_correct: null,
    reading_present: true,
    reading_correct: null,
    homework_done: null,
    memo: '',
    answers,
  }
}

const noop = () => {}

function renderSheet(questions: ExamQuestion[], answers: GradeRow['answers'], updateAnswer = vi.fn()) {
  render(
    <ExamSheetContent
      weekId="w1"
      row={row(answers)}
      questions={questions}
      readingTotal={questions.length}
      updateRow={noop}
      updateAnswer={updateAnswer}
      updateAnswerText={noop}
    />,
  )
  return updateAnswer
}

describe('ExamSheetContent — 객관식 압축 정오표', () => {
  it('요약이 정/오/입력 수를 즉시 반영한다 (저장 전에도 로컬 판정)', () => {
    const questions = [
      q({ id: 'q1', question_number: 1, correct_answer: 3 }),
      q({ id: 'q2', question_number: 2, correct_answer: 2, extra_correct_answers: [4] }),
      q({ id: 'q3', question_number: 3, correct_answer: 1 }),
      q({ id: 'q4', question_number: 4, correct_answer: 5, is_void: true }),
    ]
    renderSheet(questions, [
      { exam_question_id: 'q1', student_answer: 3 },
      { exam_question_id: 'q2', student_answer: 4 }, // 복수정답
      { exam_question_id: 'q3', student_answer: 2 },
      { exam_question_id: 'q4', student_answer: 1 }, // 무효 → 제외
    ])
    expect(screen.getByText('2정')).toBeTruthy()
    expect(screen.getByText('1오')).toBeTruthy()
    expect(screen.getByText(/3\/3개 입력/)).toBeTruthy() // 무효 문항은 분모에서도 제외
    expect(screen.getByText('무효')).toBeTruthy()
  })

  it('번호 버튼을 누르면 updateAnswer, 같은 번호를 다시 누르면 null', () => {
    const questions = [q({ id: 'q1', question_number: 1, correct_answer: 3 })]
    const updateAnswer = renderSheet(questions, [{ exam_question_id: 'q1', student_answer: 3 }])
    const buttons = screen.getAllByRole('button', { name: /^[1-5]$/ })
    expect(buttons).toHaveLength(5)
    fireEvent.click(buttons[1]) // 2번
    expect(updateAnswer).toHaveBeenLastCalledWith('s1', 'q1', 2)
    fireEvent.click(buttons[2]) // 이미 고른 3번 → 해제
    expect(updateAnswer).toHaveBeenLastCalledWith('s1', 'q1', null)
  })

  it('소문항(a/b)은 답안지처럼 한 행에 (a) (b) 가로 — 번호 한 번, 버튼 10개', () => {
    const questions = [
      q({ id: 'q1a', question_number: 1, sub_label: 'a', correct_answer: 1 }),
      q({ id: 'q1b', question_number: 1, sub_label: 'b', correct_answer: 2 }),
    ]
    renderSheet(questions, [])
    expect(screen.getAllByRole('button', { name: /^[1-5]$/ })).toHaveLength(10)
    expect(screen.getAllByRole('row')).toHaveLength(1)
    expect(screen.getByText('(a)')).toBeTruthy()
    expect(screen.getByText('(b)')).toBeTruthy()
  })

  it('행 순서는 문항 번호 순 — 서술형·O/X 도 답안지처럼 제자리에 (아래로 몰지 않음)', () => {
    const questions = [
      q({ id: 'q3', question_number: 3, correct_answer: 3 }),
      q({ id: 'q1', question_number: 1, question_style: 'subjective', correct_answer_text: '모범답안' }),
      q({ id: 'q2', question_number: 2, question_style: 'ox', correct_answer_text: 'X → have' }),
    ]
    renderSheet(questions, [])
    const rows = screen.getAllByRole('row')
    expect(rows.map((r) => r.querySelector('td')?.textContent?.trim().charAt(0))).toEqual(['1', '2', '3'])
    expect(screen.getByPlaceholderText('답안 입력')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'O' })).toBeTruthy()
    expect(screen.getByText(/채점 저장 버튼을 눌러야 AI 채점/)).toBeTruthy()
  })

  it('서술형 입력은 blur 때 부모로 올라간다', () => {
    const questions = [q({ id: 'q1', question_number: 1, question_style: 'subjective', correct_answer_text: '모범답안' })]
    const updateAnswerText = vi.fn()
    render(
      <ExamSheetContent
        weekId="w1"
        row={row([])}
        questions={questions}
        readingTotal={1}
        updateRow={noop}
        updateAnswer={noop}
        updateAnswerText={updateAnswerText}
      />,
    )
    const textarea = screen.getByPlaceholderText('답안 입력')
    fireEvent.change(textarea, { target: { value: '학생 답' } })
    expect(updateAnswerText).not.toHaveBeenCalled()
    fireEvent.blur(textarea)
    expect(updateAnswerText).toHaveBeenCalledWith('s1', 'q1', '학생 답')
  })

  it('원본 이미지 아이콘을 누르면 미리보기가 열린다', () => {
    const questions = [q({ id: 'q1', question_number: 1, correct_answer: 3, source_image_path: 'p/1.png', source_page: 2 })]
    renderSheet(questions, [])
    expect(screen.queryByText(/원본 페이지 2/)).toBeNull()
    fireEvent.click(screen.getByTitle('원본 페이지 보기'))
    expect(screen.getByText(/원본 페이지 2/)).toBeTruthy()
  })

  it('문항이 없고 총 개수만 있으면 직접 입력 필드', () => {
    render(
      <ExamSheetContent
        weekId="w1"
        row={row([])}
        questions={[]}
        readingTotal={20}
        updateRow={noop}
        updateAnswer={noop}
        updateAnswerText={noop}
      />,
    )
    expect(within(document.body).getByText('진단평가')).toBeTruthy()
  })
})
