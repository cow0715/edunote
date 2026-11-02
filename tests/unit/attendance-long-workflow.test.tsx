// @vitest-environment jsdom
import { Suspense } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WeekDetailPage from '@/app/(admin)/dashboard/[classId]/weeks/[weekId]/page'

const fixture = vi.hoisted(() => ({
 week: {id:'w',class_id:'c',week_number:1,start_date:'2026-07-15',vocab_total:0,reading_total:0,homework_total:0},
 cls: {id:'c',name:'80명 테스트반',start_date:'2026-07-15',end_date:'2026-07-22',schedule_days:['wed']},
 students:Array.from({length:80},(_,index)=>({id:`cs${index}`,student_id:`s${index}`,created_at:'2026-01-01',student:{id:`s${index}`,name:`학생${String(index+1).padStart(2,'0')}`}})),
 update:vi.fn(),
}))
vi.mock('@/hooks/use-weeks',()=>({useWeek:()=>({data:fixture.week,isLoading:false}),useWeeks:()=>({data:[fixture.week]}),useUpdateWeek:()=>({isPending:false,mutateAsync:fixture.update})}))
vi.mock('@/hooks/use-classes',()=>({useClass:()=>({data:fixture.cls}),useClassPeriods:()=>({data:[]})}))
vi.mock('@/hooks/use-students',()=>({useClassStudents:()=>({data:fixture.students})}))
vi.mock('@/hooks/use-grade',()=>({useGradeData:()=>({data:{classStudents:fixture.students}})}))
vi.mock('@/components/grade/grade-grid',()=>({GradeGrid:({onOpenAttendance}:{onOpenAttendance:()=>void})=><button onClick={onOpenAttendance}>출결 관리</button>}))
vi.mock('@/components/grade/sms-sheet',()=>({SmsSheet:()=>null}))
vi.mock('@/components/grade/answer-sheet-uploader',()=>({AnswerSheetUploader:()=>null}))
vi.mock('@/components/grade/question-type-editor',()=>({QuestionTypeEditor:()=>null}))
vi.mock('@/components/grade/vocab-word-setup',()=>({VocabWordSetup:()=>null}))
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}))
let client:QueryClient

afterEach(()=>{cleanup();client?.clear();vi.unstubAllGlobals();vi.restoreAllMocks()})
it('protects close/Escape/date changes and retains all 80-student edits through a failed save and retry',async()=>{
 client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false},mutations:{retry:false}}})
 let serverRecords=[{student_id:'s0',status:'late',note:'기존 메모'},{student_id:'s1',status:'absent',note:null}] as {student_id:string;status:string;note:string|null}[]
 client.setQueryData(['attendance','c','2026-07-15'],serverRecords)
 client.setQueryData(['attendance','c','2026-07-22'],[])
 let finish!: (value:unknown)=>void
 const writes:{date:string;records:typeof serverRecords}[]=[]
 const request=vi.fn(async (_url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){
   const body=JSON.parse(String(init.body));writes.push(body)
   if(writes.length===1)return new Promise(resolve=>{finish=resolve})
   const merged=new Map(serverRecords.map(record=>[record.student_id,record]))
   for(const record of body.records)merged.set(record.student_id,record)
   serverRecords=[...merged.values()]
  }
  return {ok:true,json:async()=>init?.method?{ok:true}:serverRecords}
 })
 vi.stubGlobal('fetch',request)
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 const params=Promise.resolve({classId:'c',weekId:'w'})
 await act(async()=>{render(<QueryClientProvider client={client}><Suspense fallback={<p>loading</p>}><WeekDetailPage params={params}/></Suspense></QueryClientProvider>)})
 fireEvent.click(await screen.findByRole('button',{name:'출결 관리'}))
 expect(screen.getByRole('tab',{name:'출결'}).getAttribute('aria-selected')).toBe('true')
 fireEvent.click(screen.getByRole('button',{name:'미기록 모두 출석'}))
 fireEvent.click(screen.getByRole('button',{name:'학생01 결석'}))
 fireEvent.click(screen.getByRole('button',{name:'학생80 결석'}))
 expect(screen.getByText('79명 변경 · 미저장')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'설정 닫기'}))
 expect(confirm).toHaveBeenCalledWith('설정에 저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')
 expect(screen.getByRole('dialog')).toBeTruthy()
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'})
 await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2))
 expect(screen.getByRole('dialog')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'다음 수업일'}))
 expect(confirm).toHaveBeenLastCalledWith('출결 변경을 저장하지 않고 날짜를 바꿀까요?')
 expect(screen.getByText('7/15')).toBeTruthy()
 const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'출결 저장'}))
 await waitFor(()=>expect(finish).toBeTypeOf('function'))
 expect((screen.getByRole('button',{name:'설정 닫기'}) as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByRole('button',{name:'다음 수업일'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'})
 expect(confirm).toHaveBeenCalledTimes(3)
 await act(async()=>finish({ok:false}))
 await waitFor(()=>expect((screen.getByRole('button',{name:'출결 저장'}) as HTMLButtonElement).disabled).toBe(false))
 expect(screen.getByRole('button',{name:'학생01 결석'}).getAttribute('aria-pressed')).toBe('true')
 expect(screen.getByRole('button',{name:'학생80 결석'}).getAttribute('aria-pressed')).toBe('true')
 expect(screen.getByText('79명 변경 · 미저장')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'출결 저장'}))
 await waitFor(()=>expect(screen.getByText('출결 저장됨')).toBeTruthy())
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0])
 expect(writes[1].records).toHaveLength(79)
 expect(writes[1].records.find(row=>row.student_id==='s0')).toEqual({student_id:'s0',status:'absent',note:'기존 메모'})
 expect(fixture.update).not.toHaveBeenCalled()
 expect(request.mock.calls.every(([url])=>url.startsWith('/api/classes/c/attendance'))).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'설정 닫기'}))
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
 expect(confirm).toHaveBeenCalledTimes(3)
},30000)

