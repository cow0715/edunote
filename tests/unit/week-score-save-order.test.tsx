// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSaveWeekScore } from '@/hooks/use-grade'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('serializes blur and clear writes across score controls in the same week',async()=>{
 let firstDone!:(value:unknown)=>void
 const fetchMock=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{firstDone=resolve})).mockResolvedValue({ok:true})
 vi.stubGlobal('fetch',fetchMock)
 const client=new QueryClient({defaultOptions:{mutations:{retry:false}}})
 const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>
 const {result}=renderHook(()=>useSaveWeekScore('w'),{wrapper})
 act(()=>{
  result.current.mutate({student_id:'s',homework_done:2.5,memo:''})
  result.current.mutate({student_id:'s',homework_done:null,memo:''})
 })
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1))
 await act(async()=>{firstDone({ok:true})})
 await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(2))
 expect(fetchMock.mock.calls.map(call=>JSON.parse(call[1].body).homework_done)).toEqual([2.5,null])
 await waitFor(()=>expect(result.current.isPending).toBe(false))
})

it('waits for memo blur and draft completion before a full grade save', async () => {
 const { useSaveGrade, useSaveGradeDraft } = await import('@/hooks/use-grade')
 const pending: Array<(value: unknown) => void> = []
 const fetchMock = vi.fn().mockImplementation(() => new Promise(resolve => pending.push(resolve)))
 vi.stubGlobal('fetch', fetchMock)
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
 const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const { result } = renderHook(() => ({ memo: useSaveWeekScore('w'), draft: useSaveGradeDraft('w'), full: useSaveGrade('w') }), { wrapper })
 const row = { student_id: 's', student_name: 'test', present: true, vocab_correct: null, reading_present: true, reading_correct: 1, homework_done: null, memo: 'new memo', answers: [{ exam_question_id: 'q', student_answer: 2 }] }
 act(() => {
  result.current.memo.mutate({ student_id: 's', memo: row.memo })
  result.current.draft.mutate([row])
  result.current.full.mutate([{ ...row, answers: [{ exam_question_id: 'q', student_answer: 3 }] }])
 })
 await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
 expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
 await act(async () => pending[0]({ ok: true }))
 await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
 expect(JSON.parse(fetchMock.mock.calls[1][1].body).skip_ai).toBe(true)
 await act(async () => pending[1]({ ok: true }))
 await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
 expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ skip_ai: false, rows: [{ memo: 'new memo', answers: [{ student_answer: 3 }] }] })
 await act(async () => pending[2]({ ok: true, json: async () => ({ ok: true }) }))
 await waitFor(() => expect(result.current.full.isPending).toBe(false))
})

it('keeps different weeks independent while one memo save is pending', async () => {
 const { useSaveGrade } = await import('@/hooks/use-grade')
 let finish!: (value: unknown) => void
 const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
 vi.stubGlobal('fetch', fetchMock)
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
 const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
 const { result } = renderHook(() => ({ memo: useSaveWeekScore('first'), full: useSaveGrade('second') }), { wrapper })
 act(() => { result.current.memo.mutate({ student_id: 's', memo: 'pending' }); result.current.full.mutate([]) })
 await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
 await waitFor(() => expect(result.current.full.isPending).toBe(false))
 expect(result.current.memo.isPending).toBe(true)
 await act(async () => finish({ ok: true }))
 await waitFor(() => expect(result.current.memo.isPending).toBe(false))
})
