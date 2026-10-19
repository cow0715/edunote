// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import StudentsPage from '@/app/(admin)/students/page'
vi.mock('@/hooks/use-students', () => ({
  useStudents: () => ({ data: [
    { id: 'a', name: '가상 A', class_student: [] },
    { id: 'b', name: '가상 B', class_student: [] },
  ], isLoading: false }),
  useDeleteStudent: () => ({ mutate: vi.fn(), isPending: false }),
  useClassStudents: () => ({ data: [] }),
}))
vi.mock('@/hooks/use-classes', () => ({ useClasses: () => ({ data: [] }) }))
vi.mock('@/components/students/student-form-dialog', () => ({ StudentFormDialog: () => null }))
vi.mock('@/components/report-cards/report-card-list-dialog', () => ({ ReportCardListDialog: () => null }))
afterEach(() => { cleanup(); localStorage.clear() })
it('offers named actions and native sortable buttons with the current direction', () => {
  render(<StudentsPage />)
  expect(screen.getByRole('button', { name: '가상 A 정보 수정' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '가상 B 삭제' })).toBeTruthy()
  const sort = screen.getByRole('button', { name: '이름' })
  expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
  fireEvent.click(sort)
  expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('descending')
  expect(within(screen.getAllByRole('row')[1]).getByText('가상 B')).toBeTruthy()
})
it('names search and filter controls and restores an empty result with reset', () => {
  render(<StudentsPage />)
  for (const label of ['이름 검색', '전화번호 검색', '학년 필터', '반 필터', '재원 상태 필터']) expect(screen.getByLabelText(label)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('이름 검색'), { target: { value: '없는 학생' } })
  expect(screen.queryByText('가상 A')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '초기화' }))
  expect(screen.getByText('가상 A')).toBeTruthy()
})
