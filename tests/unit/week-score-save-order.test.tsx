// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSaveWeekScore, useSaveGradeDraft, useSaveGrade } from '@/hooks/use-grade'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const version={score_id:null,revision:'a'.repeat(64)}
const row={grade_version:version,student_id:'s',student_name:'sample',present:true,reading_present:true,reading_correct:1,vocab_correct:null,homework_done:null,memo:'new memo',answers:[{exam_question_id:'q',student_answer:2}]}
const reply=()=>Response.json({ok:true,versions:[{student_id:'s',score_id:null,revision:'b'.repeat(64)}]})
function setup(){
 const client=new QueryClient({defaultOptions:{mutations:{retry:false}}})
 return function Wrapper({children}:{children:ReactNode}) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}
it('serializes blur and clear writes across score controls in the same week',async()=>{
 let finish!:(r:Response)=>void
 const transport=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockImplementation(async()=>reply())
 vi.stubGlobal('fetch',transport)
 const {result}=renderHook(()=>useSaveWeekScore('w'),{wrapper:setup()})
 act(()=>{result.current.mutate({...row,homework_done:2.5});result.current.mutate({...row,homework_done:null})})
 await waitFor(()=>expect(transport).toHaveBeenCalledTimes(1))
 await act(async()=>finish(reply()))
 await waitFor(()=>expect(transport).toHaveBeenCalledTimes(2))
 expect(transport.mock.calls.map(c=>JSON.parse(c[1].body).homework_done)).toEqual([2.5,null])
 expect(JSON.parse(transport.mock.calls[1][1].body).grade_version.revision).toBe('b'.repeat(64))
})
it('waits for memo blur and draft completion before a full grade save',async()=>{
 const pending:Array<(r:Response)=>void>=[]
 const transport=vi.fn().mockImplementation(()=>new Promise(resolve=>pending.push(resolve)))
 vi.stubGlobal('fetch',transport)
 const {result}=renderHook(()=>({memo:useSaveWeekScore('w'),draft:useSaveGradeDraft('w'),full:useSaveGrade('w')}),{wrapper:setup()})
 act(()=>{result.current.memo.mutate(row);result.current.draft.mutate([row]);result.current.full.mutate([{...row,answers:[{exam_question_id:'q',student_answer:3}]}])})
 await waitFor(()=>expect(transport).toHaveBeenCalledTimes(1))
 await act(async()=>pending[0](reply()))
 await waitFor(()=>expect(transport).toHaveBeenCalledTimes(2))
 expect(JSON.parse(transport.mock.calls[1][1].body).skip_ai).toBe(true)
 await act(async()=>pending[1](reply()))
 await waitFor(()=>expect(transport).toHaveBeenCalledTimes(3))
 expect(JSON.parse(transport.mock.calls[2][1].body)).toMatchObject({skip_ai:false,rows:[{answers:[{student_answer:3}]}]})
 await act(async()=>pending[2](reply()))
 await waitFor(()=>expect(result.current.full.isPending).toBe(false))
})
it('keeps different weeks independent while one memo save is pending',async()=>{
 let finish!:(r:Response)=>void
 const transport=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockImplementation(async()=>reply())
 vi.stubGlobal('fetch',transport)
 const {result}=renderHook(()=>({memo:useSaveWeekScore('first'),full:useSaveGrade('second')}),{wrapper:setup()})
 act(()=>{result.current.memo.mutate(row);result.current.full.mutate([row])})
 await waitFor(()=>expect(transport).toHaveBeenCalledTimes(2))
 await waitFor(()=>expect(result.current.full.isPending).toBe(false))
 expect(result.current.memo.isPending).toBe(true)
 await act(async()=>finish(reply()))
})
