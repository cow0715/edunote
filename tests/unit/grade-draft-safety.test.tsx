// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GradeGrid } from '@/components/grade/grade-grid'

vi.mock('@/components/grade/vocab-sheet-content', () => ({ VocabSheetContent: () => null }))
vi.mock('@/components/grade/subjective-review-panel', () => ({ SubjectiveReviewPanel: () => null }))
vi.mock('@/components/grade/mobile-grade-cards', () => ({ MobileGradeCards: () => null }))
vi.mock('@/components/grade/vocab-batch-grade-dialog', () => ({ VocabBatchGradeDialog: () => null }))
vi.mock('@/components/grade/exam-batch-grade-dialog', () => ({ ExamBatchGradeDialog: () => null }))
vi.mock('@/components/grade/exam-photo-button', () => ({ ExamPhotoButton: () => null }))
vi.mock('@/components/grade/source-image-preview', () => ({ SourceImagePreview: () => null }))

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })
function fixture() {
  return {
    classStudents: [{ student_id: 's1', student: { name: '학생1' } }, { student_id: 's2', student: { name: '학생2' } }],
    weekScores: [{id:'score1',student_id:'s1',reading_correct:0,student_answer:[]},{id:'score2',student_id:'s2',reading_correct:0,student_answer:[]}], attendance: [],
    questions: [{ id: 'q1', week_id: 'w', question_number: 1, question_style: 'subjective', correct_answer_text: 'model', is_void: false, sub_label: null }],
  }
}
function setup(post: (body: Record<string, unknown>) => Promise<unknown> = async () => ({ ok: true, json: async () => ({ ok: true }) }), data: Record<string,unknown> = fixture(), homeworkTotal = 0, attendanceContext = false) {
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return {ok:true,json:async()=>_url.includes('/attendance')?data.attendance:data}
    const body=JSON.parse(String(init.body))
    const response=await post(body) as {ok:boolean;json?:()=>Promise<Record<string,unknown>>}
    if (!response.ok) return response
    const result=await response.json?.() ?? {ok:true}
    const submitted=(body.rows ?? [body]) as Record<string,unknown>[]
    const versions=submitted.map(row=>({student_id:row.student_id,score_id:null,revision:'b'.repeat(64)}))
    const scores=(data.weekScores ?? []) as Record<string,unknown>[]
    for(const row of submitted){
      const previous=scores.find(score=>score.student_id===row.student_id)
      if(!previous)continue
      const {answers,...fields}=row
      Object.assign(previous,body.draft_only?{reading_correct:row.reading_present===false?null:row.reading_correct}:fields)
      if(answers)previous.student_answer=answers
    }
    data.grade_versions=versions
    return {...response,json:async()=>({...result,versions})}
  })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData(['grade', 'w'], data)
  if(attendanceContext) client.setQueryData(['attendance','c','2026-04-08'],data.attendance ?? [])
  const openAttendance = vi.fn()
  const view = render(<QueryClientProvider client={client}><GradeGrid classId={attendanceContext ? "c" : undefined} attendanceDate={attendanceContext ? "2026-04-08" : undefined} onOpenAttendance={attendanceContext ? openAttendance : undefined} weekId="w" vocabTotal={0} readingTotal={1} homeworkTotal={homeworkTotal} /></QueryClientProvider>)
  return { client, fetchMock, view, openAttendance }
}

it('waits for save, stays on failure with retained answers, then moves after retry', async () => {
  let finish!: (value: unknown) => void
  let calls = 0
  const { fetchMock } = setup(() => ++calls === 1 ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ ok: true }))
  fireEvent.click(await screen.findByRole('button', { name: '학생1 시험 답안 열기' }))
  fireEvent.change(screen.getByRole('textbox', { name: '1번 학생 답안' }), { target: { value: 'typed without blur' } })
  fireEvent.click(screen.getByRole('button', { name: '다음 학생' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(screen.getByRole('heading', { name: '학생1' })).toBeTruthy()
  expect(screen.getByText('변경된 답안이 있습니다. 저장 후 이동합니다.')).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: '답안 임시 저장' })).toBeTruthy()
  expect((screen.getByRole('button', { name: '다음 학생' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(screen.getByRole('heading',{name:/학생[12]/}),{key:'ArrowRight'})
  fireEvent.click(screen.getByRole('button',{name:'답안 닫기'}))
  expect(screen.getByRole('heading', { name: '학생1' })).toBeTruthy()
  await act(async () => finish({ ok: false, json: async () => ({ error: 'save failed' }) }))
  expect(screen.getByRole('heading', { name: '학생1' })).toBeTruthy()
  expect((screen.getByRole('textbox', {name:'1번 학생 답안'}) as HTMLTextAreaElement).value).toBe('typed without blur')
  expect(localStorage.getItem('edunote:grade-input:w')).toContain('typed without blur')
  fireEvent.click(screen.getByRole('button', { name: '다음 학생' }))
  await screen.findByRole('heading', { name: '학생2' })
  expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(2)
  await waitFor(() => expect(localStorage.getItem('edunote:grade-input:w')).toBeNull())
})

it('keeps edited fields when background query data changes, and protects page unload', async () => {
  const { client } = setup()
  fireEvent.click(await screen.findByRole('button', { name: '학생1 시험 답안 열기' }))
  fireEvent.change(screen.getByRole('textbox', { name: '1번 학생 답안' }), { target: { value: 'local draft' } })
  act(() => client.setQueryData(['grade', 'w'], { ...fixture(), attendance: [{ student_id: 's2', status: 'absent' }] }))
  expect((screen.getByRole('textbox', { name: '1번 학생 답안' }) as HTMLTextAreaElement).value).toBe('local draft')
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '답안 닫기' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: '학생1' })).toBeNull())
  const saved = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(saved)
  expect(saved.defaultPrevented).toBe(false)
})

it('does not mark a newer memo edit saved when an older blur request completes', async () => {
  let finish!: (value: unknown) => void
  setup(() => new Promise(resolve => { finish = resolve }))
  const memo = await screen.findByRole('textbox', { name: '학생1 메모' })
  fireEvent.change(memo, { target: { value: 'first' } })
  fireEvent.blur(memo)
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  fireEvent.change(memo, { target: { value: 'newer edit' } })
  await act(async () => finish({ ok: true }))
  expect((memo as HTMLInputElement).value).toBe('newer edit')
  expect(screen.getByText('미저장 변경이 있습니다')).toBeTruthy()
})

it('reports roster size rather than claiming grading is complete', async () => {
  setup()
  expect(await screen.findByText(/전체 2명/)).toBeTruthy()
  expect(screen.queryByText(/채점 2 \/ 전체 2명/)).toBeNull()
})

it('keeps the answer open on Escape until its save completes', async () => {
  let finish!: (value: unknown) => void
  const { fetchMock } = setup(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(await screen.findByRole('button', { name: '학생1 시험 답안 열기' }))
  fireEvent.change(screen.getByRole('textbox', { name: '1번 학생 답안' }), { target: { value: 'last keystroke' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: '1번 학생 답안' }), { key: 'Escape' })
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(screen.getByRole('heading', { name: '학생1' })).toBeTruthy()
  expect(screen.getByRole('progressbar',{name:'답안 임시 저장'})).toBeTruthy()
  expect(JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === 'POST')![1].body).skip_ai).toBe(true)
  await act(async () => finish({ ok: true }))
  await waitFor(() => expect(screen.queryByRole('heading', {name:'학생1'})).toBeNull())
})

it('opens an overview request by student ID and does not reopen it after closing or refetching', async () => {
  const { client, view } = setup()
  const request = { studentId: 's2', type: 'exam' as const }
  const content = () => <QueryClientProvider client={client}><GradeGrid weekId="w" vocabTotal={0} readingTotal={1} homeworkTotal={0} answerRequest={request} /></QueryClientProvider>
  view.rerender(content())
  await screen.findByRole('heading', { name: '학생2' })
  fireEvent.click(screen.getByRole('button', { name: '답안 닫기' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: '학생2' })).toBeNull())
  act(() => client.setQueryData(['grade', 'w'], { ...fixture(), classStudents: [...fixture().classStudents].reverse() }))
  expect(screen.queryByRole('heading', { name: '학생2' })).toBeNull()
  view.rerender(<QueryClientProvider client={client}><GradeGrid weekId="w" vocabTotal={0} readingTotal={1} homeworkTotal={0} answerRequest={{ studentId: 's1', type: 'exam' }} /></QueryClientProvider>)
  await screen.findByRole('heading', { name: '학생1' })
})

it('hides the answer portal on tab history changes while retaining the selected student', async () => {
  const { client, view } = setup()
  fireEvent.click(await screen.findByRole('button', { name: '학생2 시험 답안 열기' }))
  const content = (active: boolean) => <QueryClientProvider client={client}><GradeGrid weekId="w" vocabTotal={0} readingTotal={1} homeworkTotal={0} active={active} /></QueryClientProvider>
  view.rerender(content(false))
  await waitFor(() => expect(screen.queryByRole('heading', { name: '학생2' })).toBeNull())
  view.rerender(content(true))
  await screen.findByRole('heading', { name: '학생2' })
})

it('labels answer actions and exposes the parent page as a named link in the unified table', async () => {
  const { client, view } = setup()
  act(() => client.setQueryData(['grade', 'w'], { ...fixture(), classStudents: [{ student_id: 's1', student: { name: '학생1', share_token: 'parent-token' } }], attendance: [{ student_id: 's1', status: 'late' }] }))
  const openAttendance = vi.fn()
  view.rerender(<QueryClientProvider client={client}><GradeGrid weekId="w" vocabTotal={0} readingTotal={1} homeworkTotal={0} onOpenAttendance={openAttendance} /></QueryClientProvider>)
  const link = await screen.findByRole('link', { name: '학생1 학부모 화면 새 탭에서 열기' })
  expect(link.getAttribute('href')).toBe('/share/parent-token')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(screen.getByRole('button', { name: '학생1 시험 답안 열기' }).textContent).not.toContain('답안 보기')
  expect(screen.getByRole('button', { name: '학생1 시험 답안 열기' }).querySelector('svg')).toBeTruthy()
  expect(screen.getByLabelText('학생1 출결 상태').textContent).toBe('지각')
  fireEvent.click(screen.getByRole('button',{name:'출결 관리'}))
  expect(openAttendance).toHaveBeenCalledOnce()
})

it('saves each student before navigation and ignores repeated navigation while pending', async () => {
 const finish: Array<(value: unknown) => void> = []
 const {fetchMock} = setup(() => new Promise(resolve => finish.push(resolve)))
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 for (const [index,value] of ['first','second','latest'].entries()) {
   fireEvent.change(screen.getByRole('textbox',{name:'1번 학생 답안'}),{target:{value}})
   const action=index===2?'답안 닫기':index===0?'다음 학생':'이전 학생'
   fireEvent.click(screen.getByRole('button',{name:action}))
   await waitFor(()=>expect(finish).toHaveLength(index+1))
   fireEvent.keyDown(screen.getByRole('heading',{name:/학생[12]/}),{key:'ArrowRight'})
   expect(finish).toHaveLength(index+1)
   expect(localStorage.getItem('edunote:grade-input:w')).toContain(value)
   await act(async()=>finish[index]({ok:true}))
   if(index<2) await screen.findByRole('heading',{name:index===0?'학생2':'학생1'})
 }
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'학생1'})).toBeNull())
 const bodies=fetchMock.mock.calls.filter(call=>call[1]?.method==='POST').map(call=>JSON.parse(call[1].body))
 expect(bodies.map(body=>[body.rows[0].student_id,body.rows[0].answers[0].student_answer_text,body.skip_ai])).toEqual([['s1','first',true],['s2','second',true],['s1','latest',true]])
 expect(localStorage.getItem('edunote:grade-input:w')).toBeNull()
})
it('recovers failed input after remount without silently overwriting server data', async () => {
 const first = setup(async()=>({ok:false,json:async()=>({error:'offline'})}))
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 fireEvent.change(screen.getByRole('textbox',{name:'1번 학생 답안'}),{target:{value:'recover me'}})
 fireEvent.click(screen.getByRole('button',{name:'다음 학생'}))
 await waitFor(()=>expect(first.fetchMock).toHaveBeenCalled())
 await waitFor(()=>expect(localStorage.getItem('edunote:grade-input:w')).toContain('recover me'))
 first.view.unmount()
 setup()
 expect(screen.queryByRole('button',{name:'입력 복원'})).toBeNull()
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 expect((screen.getByRole('textbox',{name:'1번 학생 답안'}) as HTMLTextAreaElement).value).toBe('recover me')
})

it('automatically resumes a draft when only an unrelated server memo changed',async()=>{
 const data=fixture()
 localStorage.setItem('edunote:grade-input:w',JSON.stringify({savedAt:Date.now(),source:JSON.stringify([[{student_id:'s1',memo:'old'}],[]]),questions:JSON.stringify(data.questions),fields:['s1:answers'],rows:[{student_id:'s1',student_name:'학생1',answers:[{exam_question_id:'q1',student_answer:null,student_answer_text:'keep typing'}]}]}))
 setup(undefined,{...data,weekScores:[{student_id:'s1',id:'score',memo:'new',reading_correct:null,student_answer:[]}]})
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 expect((screen.getByRole('textbox',{name:'1번 학생 답안'}) as HTMLTextAreaElement).value).toBe('keep typing')
 expect(screen.queryByRole('dialog',{name:'다른 수정 내용이 있습니다'})).toBeNull()
 expect(screen.queryByText(/브라우저에 보관된/)).toBeNull()
})
it('shows a comparison only for a real server conflict and never overwrites before a decision',async()=>{
 const data=fixture()
 localStorage.setItem('edunote:grade-input:w',JSON.stringify({savedAt:Date.now(),source:JSON.stringify([[],[]]),questions:JSON.stringify(data.questions),fields:['s1:answers'],rows:[{student_id:'s1',student_name:'학생1',answers:[{exam_question_id:'q1',student_answer:null,student_answer_text:'my input'}]}]}))
 const {fetchMock}=setup(undefined,{...data,weekScores:[{student_id:'s1',id:'score',reading_correct:1,student_answer:[{exam_question_id:'q1',student_answer:null,student_answer_text:'new server input',is_correct:true}]}]})
 await screen.findByRole('dialog',{name:'다른 수정 내용이 있습니다'})
 expect(screen.getByText(/my input/)).toBeTruthy()
 expect(screen.getByText(/new server input/)).toBeTruthy()
 expect(fetchMock.mock.calls.filter(call=>call[1]?.method)).toHaveLength(0)
 expect(localStorage.getItem('edunote:grade-input:w')).toContain('my input')
 fireEvent.click(screen.getByRole('button',{name:'최신 자료 사용'}))
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 expect((screen.getByRole('textbox',{name:'1번 학생 답안'}) as HTMLTextAreaElement).value).toBe('new server input')
})

it('inline homework preserves decimals, null/zero and memo through the existing PATCH queue and retries',async()=>{
 let attempts=0
 const data={...fixture(),weekScores:[{id:'score',student_id:'s1',reading_correct:0,homework_done:null,memo:'keep this memo',student_answer:[]}]}
 const {fetchMock}=setup(async()=>++attempts===1?{ok:false}:{ok:true},data,6)
 fireEvent.click(await screen.findByRole('button',{name:'학생1 숙제 수정'}))
 const input=screen.getByRole('textbox',{name:'학생1 숙제 완료량'})
 fireEvent.focus(input)
 fireEvent.change(input,{target:{value:'2.5'}})
 expect(fetchMock.mock.calls.filter(call=>call[1]?.method)).toHaveLength(0)
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await screen.findByRole('alert')
 expect(localStorage.getItem('edunote:grade-input:w')).toContain('2.5')
 expect((input as HTMLInputElement).value).toBe('2.5')
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(true))
 for(const value of ['0','']){
  fireEvent.change(input,{target:{value}})
  fireEvent.click(screen.getByRole('button',{name:'저장'}))
  await waitFor(()=>expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(true))
 }
 const writes=fetchMock.mock.calls.filter(call=>call[1]?.method)
 expect(writes.map(call=>call[1].method)).toEqual(['PATCH','PATCH','PATCH','PATCH'])
 expect((screen.getByRole('textbox',{name:'학생1 메모'}) as HTMLInputElement).value).toBe('keep this memo')
 expect(writes.map(call=>{const {grade_version,...payload}=JSON.parse(call[1].body);expect(grade_version).toBeTruthy();return payload})).toEqual([2.5,2.5,0,null].map(value=>({student_id:'s1',homework_done:value})))
 await waitFor(()=>expect(localStorage.getItem('edunote:grade-input:w')).toBeNull())
})

it('saves the outgoing exam draft when selecting another student directly in the desktop table', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  let finish!: (value: unknown) => void
  const { fetchMock } = setup(() => new Promise(resolve => { finish = resolve }))
  fireEvent.click(await screen.findByRole('button', { name: '학생1 시험 답안 열기' }))
  expect(screen.getByRole('region', { name: '학생 답안 채점' })).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: '1번 학생 답안' }), { target: { value: 'desktop draft' } })
  fireEvent.click(screen.getByRole('button', { name: '학생2 시험 답안 열기' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(screen.getByRole('heading',{name:'학생1'})).toBeTruthy()
  const request = fetchMock.mock.calls.find(([,init]) => init?.method === 'POST')
  const body = JSON.parse(String(request?.[1]?.body))
  expect(body.draft_only).toBe(true)
  expect(body.skip_ai).toBe(true)
  expect(JSON.stringify(body)).toContain('desktop draft')
  await act(async () => { finish({ok:true,json:async()=>({ok:true})}) })
  await screen.findByRole('heading',{name:'학생2'})
})

it('keeps exclusion out of the daily workspace and preserves inclusion values in final save', async () => {
  const {fetchMock} = setup()
  await screen.findByRole('button',{name:'학생1 시험 답안 열기'})
  expect(screen.queryByRole('button',{name:/성적 포함 설정/})).toBeNull()
  expect(screen.queryByRole('columnheader',{name:'성적 반영'})).toBeNull()
  expect(screen.queryByRole('checkbox',{name:/성적 포함/})).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'서술형 채점'}))
  await waitFor(()=>expect(fetchMock.mock.calls.some(([,init])=>init?.method==='POST')).toBe(true))
  const request=fetchMock.mock.calls.find(([,init])=>init?.method==='POST')
  const body=JSON.parse(String(request?.[1]?.body))
  expect(body.skip_ai).toBe(false)
  expect(body.rows.map((row:{present:boolean})=>row.present)).toEqual([true,true])
})

it('shows read-only attendance and opens the single existing attendance manager without writes',async()=>{
 const data={...fixture(),attendance:[{student_id:'s1',status:'late',note:'keep note'}]}
 const {fetchMock,openAttendance}=setup(undefined,data,6,true)
 expect(await screen.findByLabelText('학생1 출결 상태')).toHaveProperty('textContent','지각')
 expect(screen.getByLabelText('학생2 출결 상태')).toHaveProperty('textContent','미기록')
 expect(screen.queryByRole('combobox',{name:'학생1 출결'})).toBeNull()
 expect(screen.queryByRole('combobox',{name:'일괄 변경 대상'})).toBeNull()
 expect(screen.queryByRole('checkbox',{name:'전체 학생 선택'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'출결 관리'}))
 expect(openAttendance).toHaveBeenCalledOnce()
 expect(fetchMock.mock.calls.filter(([,init])=>init?.method)).toHaveLength(0)
})

it('refreshes attendance labels without changing pending exam input or participation',async()=>{
 const {client,fetchMock}=setup(undefined,{...fixture(),attendance:[{student_id:'s1',status:'late'}]},0,true)
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 fireEvent.change(screen.getByRole('textbox',{name:'1번 학생 답안'}),{target:{value:'preserved'}})
 act(()=>client.setQueryData(['attendance','c','2026-04-08'],[{student_id:'s1',status:'absent'}]))
 await waitFor(()=>expect(screen.getByLabelText('학생1 출결 상태',{selector:'span'}).textContent).toBe('결석'))
 expect((screen.getByRole('textbox',{name:'1번 학생 답안'}) as HTMLTextAreaElement).value).toBe('preserved')
 expect(screen.getByRole('switch',{name:'학생1 시험 응시'}).getAttribute('aria-checked')).toBe('true')
 expect(fetchMock.mock.calls.filter(([,init])=>init?.method)).toHaveLength(0)
})

it('does not save staged homework when a memo loses focus',async()=>{
 const {fetchMock}=setup(async()=>({ok:true}),fixture(),6)
 fireEvent.click(await screen.findByRole('button',{name:'학생1 숙제 수정'}))
 const input=screen.getByRole('textbox',{name:'학생1 숙제 완료량'})
 fireEvent.focus(input)
 fireEvent.change(input,{target:{value:'2.5'}})
 const memo=screen.getByRole('textbox',{name:'학생1 메모'})
 fireEvent.change(memo,{target:{value:'memo only'}})
 fireEvent.blur(memo)
 await waitFor(()=>expect(fetchMock.mock.calls.filter(([,init])=>init?.method)).toHaveLength(1))
 const payload=JSON.parse(fetchMock.mock.calls.find(([,init])=>init?.method)?.[1].body)
 expect(payload).toMatchObject({student_id:'s1',memo:'memo only',grade_version:expect.any(Object)})
 expect(payload).not.toHaveProperty('homework_done')
 expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(false)
})

it('keeps homework entry available while an exam draft saves in the background',async()=>{
 let finish!: (value:unknown)=>void
 setup(()=>new Promise(resolve=>{finish=resolve}),fixture(),6)
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 fireEvent.change(screen.getByRole('textbox',{name:'1번 학생 답안'}),{target:{value:'draft'}})
 fireEvent.click(screen.getByRole('button',{name:'다음 학생'}))
 await waitFor(()=>expect(finish).toBeTypeOf('function'))
 expect((screen.getByRole('button',{name:'학생2 숙제 수정',hidden:true}) as HTMLButtonElement).disabled).toBe(false)
 await act(async()=>finish({ok:true,json:async()=>({ok:true})}))
})

it('unifies homework and answer saving without AI, retaining only the failed answers for retry',async()=>{
 vi.stubGlobal('matchMedia',vi.fn().mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}))
 let drafts=0
 const {fetchMock}=setup(async body=>body.draft_only && ++drafts===1?{ok:false,json:async()=>({error:'draft failed'})}:{ok:true,json:async()=>({ok:true})},fixture(),6)
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 fireEvent.change(screen.getByRole('textbox',{name:'1번 학생 답안'}),{target:{value:'keep this answer'}})
 fireEvent.click(screen.getByRole('button',{name:'학생1 숙제 수정'}))
 const homework=screen.getByRole('textbox',{name:'학생1 숙제 완료량'})
 fireEvent.focus(homework)
 fireEvent.change(homework,{target:{value:'2.5'}})
 expect(screen.queryByRole('button',{name:'답안 임시저장'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await screen.findByText('답안 저장 실패 · 입력은 유지됩니다. 저장을 다시 눌러 주세요.')
 expect(localStorage.getItem('edunote:grade-input:w')).toContain('keep this answer')
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(true))
 const writes=fetchMock.mock.calls.filter(([,init])=>init?.method)
 expect(writes.filter(([,init])=>init.method==='PATCH')).toHaveLength(1)
 const requests=writes.filter(([,init])=>init.method==='POST').map(([,init])=>JSON.parse(init.body))
 expect(requests).toHaveLength(2)
 expect(requests.every(body=>body.skip_ai===true && body.draft_only===true)).toBe(true)
 expect((screen.getByRole('textbox',{name:'1번 학생 답안'}) as HTMLInputElement).value).toBe('keep this answer')
})
it('shows only ordinary save on a week without subjective AI grading',async()=>{
 const data={...fixture(),questions:[{...fixture().questions[0],question_style:'objective'}]}
 const {fetchMock}=setup(async()=>({ok:true}),data,6)
 expect(screen.queryByRole('button',{name:'서술형 채점'})).toBeNull()
 fireEvent.click(await screen.findByRole('button',{name:'학생1 숙제 수정'}))
 const input=screen.getByRole('textbox',{name:'학생1 숙제 완료량'})
 fireEvent.focus(input);fireEvent.change(input,{target:{value:'0'}})
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(fetchMock.mock.calls.filter(([,init])=>init?.method)).toHaveLength(1))
 expect(fetchMock.mock.calls.find(([,init])=>init?.method)?.[1].method).toBe('PATCH')
})

it('keeps upload/review actions and individual homework entry without bulk controls',async()=>{
 setup(undefined,fixture(),6,true)
 expect(await screen.findByRole('button',{name:'독해 사진 채점'})).toBeTruthy()
 expect(screen.getByRole('button',{name:'검토할 답안'})).toBeTruthy()
 expect(screen.getByRole('button',{name:'출결 관리'})).toBeTruthy()
 expect(screen.queryByRole('combobox',{name:'일괄 변경 항목'})).toBeNull()
 expect(screen.queryByText(/명 출석 처리/)).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'학생1 숙제 수정'}))
 expect(screen.getByRole('textbox',{name:'학생1 숙제 완료량'})).toBeTruthy()
})


it('keeps absent students editable and preserves a real zero and existing answer on AI save',async()=>{
 const data={...fixture(),attendance:[{student_id:'s1',status:'absent'}],weekScores:[{id:'score1',student_id:'s1',reading_correct:0,vocab_correct:0,homework_done:2.5,student_answer:[{exam_question_id:'q1',student_answer:null,student_answer_text:'retained answer',is_correct:false}]}]}
 const {fetchMock}=setup(async()=>({ok:true,json:async()=>({ok:true})}),data,6,true)
 expect((await screen.findByRole('button',{name:'학생1 시험 답안 열기'}) as HTMLButtonElement).disabled).toBe(false)
 expect((screen.getByRole('button',{name:'학생1 숙제 수정'}) as HTMLButtonElement).disabled).toBe(false)
 fireEvent.click(screen.getByRole('button',{name:'서술형 채점'}))
 await waitFor(()=>expect(fetchMock.mock.calls.some(([url,init])=>url.endsWith('/grade') && init?.method==='POST')).toBe(true))
 const request=fetchMock.mock.calls.find(([url,init])=>url.endsWith('/grade') && init?.method==='POST')
 expect(JSON.parse(request?.[1].body).rows[0]).toMatchObject({present:true,reading_present:true,reading_correct:0,answers:[{student_answer_text:'retained answer'}]})
})
it('never infers exam participation from class attendance for a student without a score',async()=>{
 const data={...fixture(),attendance:[{student_id:'s1',status:'present'},{student_id:'s2',status:'absent'}],weekScores:[]}
 setup(async()=>({ok:true,json:async()=>({ok:true})}),data,6,true)
 fireEvent.click(await screen.findByRole('button',{name:'학생2 시험 답안 열기'}))
 expect((screen.getByRole('switch',{name:'학생2 시험 응시'}) as HTMLButtonElement).getAttribute('aria-checked')).toBe('false')
 fireEvent.click(screen.getByRole('switch',{name:'학생2 시험 응시'}))
 expect((screen.getByRole('textbox',{name:'1번 학생 답안'}) as HTMLInputElement).disabled).toBe(false)
})

it('preserves the acknowledged version chain when memo saving queues behind a cloned exam snapshot',async()=>{
 vi.stubGlobal('matchMedia',vi.fn().mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}))
 const pending:Array<(value:unknown)=>void>=[]
 const data={...fixture(),grade_versions:['s1','s2'].map(student_id=>({student_id,score_id:null,revision:'a'.repeat(64)}))}
 const {fetchMock}=setup(()=>new Promise(resolve=>pending.push(resolve)),data)
 fireEvent.click(await screen.findByRole('button',{name:'학생1 시험 답안 열기'}))
 fireEvent.change(screen.getByRole('textbox',{name:'1번 학생 답안'}),{target:{value:'queued answer'}})
 fireEvent.click(screen.getByRole('button',{name:'다음 학생'}))
 await waitFor(()=>expect(pending).toHaveLength(1))
 const memo=screen.getByRole('textbox',{name:'학생1 메모'})
 fireEvent.change(memo,{target:{value:'queued memo'}});fireEvent.blur(memo)
 expect(pending).toHaveLength(1)
 await act(async()=>pending[0]({ok:true}))
 await waitFor(()=>expect(pending).toHaveLength(2))
 const writes=fetchMock.mock.calls.filter(([,init])=>init?.method)
 expect(writes.map(([,init])=>init.method)).toEqual(['POST','PATCH'])
 expect(JSON.parse(writes[1][1].body).grade_version.revision).toBe('b'.repeat(64))
 await act(async()=>pending[1]({ok:true}))
 expect((screen.getByRole('textbox',{name:'학생1 메모'}) as HTMLInputElement).value).toBe('queued memo')
})
