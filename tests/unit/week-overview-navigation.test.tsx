// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WeekResultTable } from '@/components/grade/week-result-table'
vi.mock('@/hooks/use-grade', () => ({ useGradeData: () => ({ data: {
  classStudents: [{ student_id: 'student-id', student: { name: '학생 이름' } }],
  questions: [{ id: 'question' }], weekScores: [{ student_id: 'student-id', reading_correct: 0, vocab_correct: null }],
} }) }))
vi.mock('@/hooks/use-attendance', () => ({ useAttendance: () => ({ data: [] }) }))
afterEach(cleanup)
it('opens the matching exam, vocabulary and attendance without changing displayed scores', () => {
  const answer = vi.fn(), attendance = vi.fn()
  render(<WeekResultTable weekId="w" classId="c" startDate="2026-07-15" vocabTotal={10} readingTotal={1} homeworkTotal={0} onOpenAnswer={answer} onOpenAttendance={attendance} />)
  fireEvent.click(screen.getByRole('button', { name: '학생 이름 시험 답안 열기' }))
  expect(answer).toHaveBeenLastCalledWith('student-id', 'exam')
  fireEvent.click(screen.getByRole('button', { name: '학생 이름 단어 답안 열기' }))
  expect(answer).toHaveBeenLastCalledWith('student-id', 'vocab')
  fireEvent.click(screen.getByRole('button', { name: '학생 이름 출결 관리 열기' }))
  expect(attendance).toHaveBeenCalledOnce()
  expect(screen.getByText('0/1')).toBeTruthy()
  expect(screen.getByText('미응시')).toBeTruthy()
})
