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
