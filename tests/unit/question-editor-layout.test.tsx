// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QuestionTypeEditor } from '@/components/grade/question-type-editor'
import { SettingsEditContext } from '@/components/grade/settings-edit-state'
import type { ExamQuestion } from '@/lib/types'
vi.mock('@/hooks/use-concept-tags', () => ({ useConceptCategories: () => ({ data: [] }), useConceptTags: () => ({ data: [] }) }))
vi.mock('@/components/grade/source-image-preview', () => ({ SourceImagePreview: () => null }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const question = (id: string, sub: string): ExamQuestion => ({ id, week_id: 'w', question_number: 1, sub_label: sub, question_style: 'subjective', exam_type: 'reading', question_stem: '공통 발문', question_text: '반복되는 전체 지문', correct_answer_text: 'model', explanation: '', grading_criteria: '', is_void: false, all_correct: false } as ExamQuestion)
it('keeps collapsed question rows compact and reports unsaved edits across a refetch', async () => {
  const data = [question('q1', 'a'), question('q2', 'b')]
  const report = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(['exam-questions', 'w'], data)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  render(<QueryClientProvider client={client}><SettingsEditContext.Provider value={report}><QuestionTypeEditor weekId="w" /></SettingsEditContext.Provider></QueryClientProvider>)
  expect(screen.queryByText('반복되는 전체 지문')).toBeNull()
  expect((screen.getByRole('button', { name: '문항 정보 저장' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getAllByRole('button', { name: '상세 수정' })[0])
  const answer = screen.getByDisplayValue('model')
  fireEvent.change(answer, { target: { value: 'teacher edit' } })
  await waitFor(() => expect(report).toHaveBeenLastCalledWith('questions', { dirty: true, busy: false }))
  client.setQueryData(['exam-questions', 'w'], [{ ...data[0], explanation: 'background update' }, data[1]])
  expect((answer as HTMLTextAreaElement).value).toBe('teacher edit')
  fireEvent.click(screen.getByRole('button', { name: '문항 정보 저장' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '문항 정보 저장' }) as HTMLButtonElement).disabled).toBe(false))
  expect((screen.getByDisplayValue('teacher edit') as HTMLTextAreaElement).value).toBe('teacher edit')
  expect(report).toHaveBeenLastCalledWith('questions', { dirty: true, busy: false })
})
