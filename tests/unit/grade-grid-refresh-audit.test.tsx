// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const m = vi.hoisted(() => ({ data: {} as Record<string, unknown>, metadata: vi.fn(), draft: vi.fn(), grade: vi.fn() }))
vi.mock('@/hooks/use-grade', () => ({
  useGradeData: () => ({ data: m.data, isLoading: false }),
  useSaveGrade: () => ({ mutate: m.grade, isPending: false }),
  useSaveGradeDraft: () => ({ mutate: m.draft }),
  useSaveWeekScore: () => ({ mutate: m.metadata }),
}))
vi.mock('@/components/grade/exam-batch-grade-dialog', () => ({ ExamBatchGradeDialog: () => null }))
vi.mock('@/components/grade/vocab-batch-grade-dialog', () => ({
  VocabBatchGradeDialog: ({ open, onGraded }: { open: boolean; onGraded: (student: string, correct: number) => void }) =>
    open ? <button onClick={() => onGraded('student', 0)}>가상 단어 채점 완료</button> : null,
}))
vi.mock('@/components/grade/vocab-sheet-content', () => ({ VocabSheetContent: () => null }))
vi.mock('@/components/grade/exam-sheet-content', () => ({ ExamSheetContent: () => null }))
vi.mock('@/components/grade/subjective-review-panel', () => ({ SubjectiveReviewPanel: () => null }))
import { GradeGrid } from '@/components/grade/grade-grid'

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('keeps a local memo when a vocab completion refetch arrives before its metadata acknowledgement', async () => {
  const score = { id: 'score', student_id: 'student', grade_revision: 1, vocab_correct: 1,
    reading_correct: 1, homework_done: null, memo: 'server memo', student_answer: [], student_vocab_answer: [] }
  m.data = { grade_versions:[{student_id:'student',score_id:null,revision:'a'.repeat(64)}], classStudents: [{ student_id: 'student', student: { name: '가상 학생' } }],
    weekScores: [score], questions: [], attendance: [] }
  const client = new QueryClient()
  const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue()
  const view = () => <QueryClientProvider client={client}><GradeGrid weekId="week" vocabTotal={2} readingTotal={0} homeworkTotal={0} /></QueryClientProvider>
  const { rerender } = render(view())
  const memo = await screen.findByPlaceholderText('메모') as HTMLInputElement
  await waitFor(() => expect(memo.value).toBe('server memo'))
  fireEvent.change(memo, { target: { value: 'not acknowledged yet' } })
  fireEvent.blur(memo)
  expect(m.metadata).toHaveBeenCalledOnce()
  expect(memo.value).toBe('not acknowledged yet')
  fireEvent.click(screen.getByRole('button', { name: '단어 시험지 일괄 채점' }))
  fireEvent.click(screen.getByRole('button', { name: '가상 단어 채점 완료' }))
  expect(refetch).toHaveBeenCalled()
  // Resolve that read with the new vocab result while the metadata request is still pending.
  m.data = { ...m.data, grade_versions:[{student_id:'student',score_id:null,revision:'b'.repeat(64)}], weekScores: [{ ...score, vocab_correct: 0, grade_revision: 2 }] }
  rerender(view())
  await waitFor(() => expect((screen.getByPlaceholderText('메모') as HTMLInputElement).value).toBe('not acknowledged yet'))
  client.clear()
})
