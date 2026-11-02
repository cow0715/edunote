// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VocabSheetContent } from '@/components/grade/vocab-sheet-content'
import { createGradeSaveQueue } from '@/lib/atomic-grade'
import { useSaveGrade, type GradeRow } from '@/hooks/use-grade'
vi.mock('@/components/grade/vocab-photo-button', () => ({ VocabPhotoButton: () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('단어 정오 수정 직후 패널을 닫고 전체 저장해도 개별 답안 저장 완료를 기다린다', async () => {
  const queue = createGradeSaveQueue()
  let finish: (() => void) | undefined
  const request = vi.fn().mockImplementation((url: string) => url === '/api/vocab-answer'
    ? new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => ({ok:true,versions:[{student_id:'student',score_id:null,revision:'b'.repeat(64)}]}) }) })
    : Promise.resolve({ ok: true, json: async () => ({ ok: true, versions:[{student_id:'student',score_id:null,revision:'c'.repeat(64)}] }) }))
  vi.stubGlobal('fetch', request)
  const row: GradeRow = { grade_version:{score_id:null,revision:null}, student_id:'student', student_name:'QA', present:true, vocab_correct:0, reading_present:false, reading_correct:null, homework_done:null, memo:'', answers:[] }
  function Save() { const save = useSaveGrade('week', queue, undefined, true); return <button onClick={() => save.mutate([row])}>전체 저장</button> }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const body = (open: boolean) => <QueryClientProvider client={client}>{open && <VocabSheetContent saveQueue={queue} row={row} weekId="week" weekScoreId="score" vocabPhotoPath={null} updateRow={vi.fn()} vocabAnswers={[{ id:'answer', number:1, english_word:'apple', student_answer:'사과', is_correct:false, teacher_locked:false }]} />}<Save /></QueryClientProvider>
  const view = render(body(true))
  fireEvent.click(screen.getByRole('button', { name:'✗' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  view.rerender(body(false))
  fireEvent.click(screen.getByRole('button', { name:'전체 저장' }))
  await waitFor(() => expect(client.getMutationCache().getAll().some(m => m.state.isPaused)).toBe(true))
  expect(request).toHaveBeenCalledTimes(1)
  finish!()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(request.mock.calls[1][0]).toBe('/api/weeks/week/grade')
  expect(JSON.parse(request.mock.calls[1][1].body).rows[0].grade_version.revision).toBe('b'.repeat(64))
})
