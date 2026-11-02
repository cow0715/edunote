// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AttendanceManager } from '@/components/attendance/attendance-manager'
import { SettingsEditContext } from '@/components/grade/settings-edit-state'
import type { ClassStudent } from '@/lib/types'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('reports attendance edits, cancels date navigation, and retains them after a failed save', async () => {
  const report = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } })
  client.setQueryData(['attendance', 'c', '2026-07-15'], [])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  const student = { student_id: 's', created_at: '2026-01-01', student: { name: '학생1', grade: '고1' } } as ClassStudent
  render(<QueryClientProvider client={client}><SettingsEditContext.Provider value={report}><AttendanceManager classId="c" classStudents={[student]} defaultDate="2026-07-15" scheduledDates={['2026-07-15', '2026-07-22']} /></SettingsEditContext.Provider></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '학생1 결석' }))
  await waitFor(() => expect(report).toHaveBeenLastCalledWith('attendance', { dirty: true, busy: false }))
  fireEvent.click(screen.getByRole('button', { name: '다음 수업일' }))
  expect(screen.getByText('7/15')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '출결 저장' }))
  await waitFor(() => expect(report).toHaveBeenLastCalledWith('attendance', { dirty: true, busy: false }))
  expect(screen.getByRole('button', { name: '학생1 결석' }).getAttribute('aria-pressed')).toBe('true')
})

it('shows former members and recorded students even when import timestamps are later than the lesson', () => {
 const client = new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}})
 client.setQueryData(['attendance','c','2026-04-08'],[{student_id:'recorded',status:'late'}])
 const students = [
  {student_id:'former',created_at:'2026-10-01',joined_at:'2026-03-01',left_at:'2026-06-01',student:{name:'Former'}},
  {student_id:'recorded',created_at:'2026-10-01',joined_at:'2026-05-01',left_at:null,student:{name:'Recorded'}},
  {student_id:'score',created_at:'2026-10-01',joined_at:'2026-05-01',left_at:null,student:{name:'Score'}},
  {student_id:'future',created_at:'2026-10-01',joined_at:'2026-05-01',left_at:null,student:{name:'Future'}},
 ] as ClassStudent[]
 render(<QueryClientProvider client={client}><AttendanceManager classId="c" classStudents={students} defaultDate="2026-04-08" recordedStudentIds={['score']} /></QueryClientProvider>)
 expect(screen.getByText('Former')).toBeTruthy()
 expect(screen.getByText('Recorded')).toBeTruthy()
 expect(screen.getByText('Score')).toBeTruthy()
 expect(screen.queryByText('Future')).toBeNull()
})


it('preserves existing attendance notes while saving changed statuses', async () => {
 const client = new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false},mutations:{retry:false}}})
 const records=[{student_id:'s1',status:'present',note:'기존 출결 메모'}]
 client.setQueryData(['attendance','c','2026-04-08'],records)
 const request=vi.fn(async (_url:string,init?:RequestInit)=>({ok:true,json:async()=>init?.method?{ok:true}:records}))
 vi.stubGlobal('fetch',request)
 const students=[{student_id:'s1',created_at:'2026-01-01',student:{name:'학생1'}},{student_id:'s2',created_at:'2026-01-01',student:{name:'학생2'}}] as ClassStudent[]
 render(<QueryClientProvider client={client}><AttendanceManager classId="c" classStudents={students} defaultDate="2026-04-08" /></QueryClientProvider>)
 fireEvent.click(screen.getByRole('button',{name:'미기록 모두 출석'}))
 fireEvent.click(screen.getByRole('button',{name:'학생1 결석'}))
 fireEvent.click(screen.getByRole('button',{name:'출결 저장'}))
 await waitFor(()=>expect(request.mock.calls.some(([,init])=>init?.method==='POST')).toBe(true))
 const body=JSON.parse(String(request.mock.calls.find(([,init])=>init?.method==='POST')?.[1]?.body))
 expect(body.records).toEqual([{student_id:'s1',status:'absent',note:'기존 출결 메모'},{student_id:'s2',status:'present',note:null}])
})


it('fills only missing students and saves only changed exceptions without overwriting existing records', async () => {
 const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false},mutations:{retry:false}}})
 const records=[{student_id:'a',status:'late',note:'지각 메모'},{student_id:'b',status:'absent',note:'결석 메모'},{student_id:'c',status:'present',note:null}]
 client.setQueryData(['attendance','c','2026-04-08'],records)
 const request=vi.fn(async (_url:string,init?:RequestInit)=>({ok:true,json:async()=>init?.method?{ok:true}:records}))
 vi.stubGlobal('fetch',request)
 const students=['a','b','c','d'].map(student_id=>({student_id,created_at:'2026-01-01',student:{name:student_id}})) as ClassStudent[]
 render(<QueryClientProvider client={client}><AttendanceManager classId="c" classStudents={students} defaultDate="2026-04-08" /></QueryClientProvider>)
 expect((screen.getByRole('button',{name:'출결 저장'}) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.getByRole('button',{name:'d 출석'}).getAttribute('aria-pressed')).toBe('false')
 fireEvent.click(screen.getByRole('button',{name:'미기록 모두 출석'}))
 expect(screen.getByRole('button',{name:'a 지각'}).getAttribute('aria-pressed')).toBe('true')
 expect(screen.getByRole('button',{name:'b 결석'}).getAttribute('aria-pressed')).toBe('true')
 expect(screen.getByRole('button',{name:'d 출석'}).getAttribute('aria-pressed')).toBe('true')
 expect(screen.getByText('1명 변경 · 미저장')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'d 결석'}))
 fireEvent.click(screen.getByRole('button',{name:'출결 저장'}))
 await waitFor(()=>expect(request.mock.calls.some(([,init])=>init?.method==='POST')).toBe(true))
 const body=JSON.parse(String(request.mock.calls.find(([,init])=>init?.method==='POST')?.[1]?.body))
 expect(body.records).toEqual([{student_id:'d',status:'absent',note:null}])
 expect(screen.getByText('지각 메모')).toBeTruthy()
 expect(screen.getByText('결석 메모')).toBeTruthy()
})

it('blocks saving when attendance cannot be loaded instead of treating everyone as present',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
 const request=vi.fn(async()=>({ok:false}))
 vi.stubGlobal('fetch',request)
 const student={student_id:'s',created_at:'2026-01-01',student:{name:'학생'}} as ClassStudent
 render(<QueryClientProvider client={client}><AttendanceManager classId="c" classStudents={[student]} defaultDate="2026-04-08" /></QueryClientProvider>)
 expect(await screen.findByRole('alert')).toBeTruthy()
 expect((screen.getByRole('button',{name:'출결 저장'}) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.queryByRole('button',{name:'미기록 모두 출석'})).toBeNull()
})
