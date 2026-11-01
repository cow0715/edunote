// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VocabSheetContent, type VocabAnswerRow } from '@/components/grade/vocab-sheet-content'
import type { GradeRow } from '@/hooks/use-grade'

vi.mock('@/components/grade/vocab-photo-button', () => ({ VocabPhotoButton: () => null }))
const error = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error } }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const row: GradeRow = { student_id: 'student', student_name: '가상 학생', present: true, reading_present: true,
  grade_version: { score_id: 'score', revision: 1 }, vocab_correct: 1, reading_correct: null,
  homework_done: null, memo: '', answers: [] }
const answer: VocabAnswerRow = { id: 'answer', number: 1, english_word: 'alpha', student_answer: 'old', is_correct: true, teacher_locked: false }

it('keeps edited vocab text and its original version across an external refresh and failed regrade', async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json({ error: '답안이 변경됐습니다.' }, { status: 409 }))
  vi.stubGlobal('fetch', request)
  const client = new QueryClient()
  const view = (currentRow: GradeRow, answers: VocabAnswerRow[]) => <QueryClientProvider client={client}>
    <VocabSheetContent row={currentRow} weekId="week" weekScoreId="score" vocabAnswers={answers} vocabPhotoPath={null} updateRow={vi.fn()} />
  </QueryClientProvider>
  const { rerender } = render(view(row, [answer]))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my pending edit' } })
  rerender(view({ ...row, grade_version: { score_id: 'score', revision: 5 } }, [{ ...answer, student_answer: 'remote edit' }]))
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('my pending edit')
  fireEvent.click(screen.getByRole('button', { name: '재채점 (1개)' }))
  await waitFor(() => expect(error).toHaveBeenCalled())
  expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({ grade_version: { revision: 1 } })
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('my pending edit')
  expect(screen.getByRole('button', { name: '재채점 (1개)' })).toBeTruthy()
  client.clear()
})

it('uses the acknowledged blur-save version for the following AI regrade', async () => {
  let revision = 1
  const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true,
    versions: [{ student_id: 'student', score_id: 'score', revision: ++revision }] }))
  vi.stubGlobal('fetch', request)
  const client = new QueryClient()
  const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined)
  render(<QueryClientProvider client={client}><VocabSheetContent row={row} weekId="week" weekScoreId="score"
    vocabAnswers={[answer]} vocabPhotoPath={null} updateRow={vi.fn()} /></QueryClientProvider>)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'edited' } })
  fireEvent.blur(input)
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '재채점 (1개)' }))
  await waitFor(() => expect(refetch).toHaveBeenCalled())
  expect(request).toHaveBeenCalledTimes(2)
  expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toMatchObject({ grade_version: { revision: 2 } })
  expect(error).not.toHaveBeenCalled()
  client.clear()
})
