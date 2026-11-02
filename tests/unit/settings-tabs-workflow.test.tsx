// @vitest-environment jsdom
import { Suspense } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WeekDetailPage from '@/app/(admin)/dashboard/[classId]/weeks/[weekId]/page'

const fixture = vi.hoisted(() => ({
 week: {id:'w',class_id:'c',week_number:1,start_date:'2026-07-15',vocab_total:0,reading_total:0,homework_total:0},
 cls: {id:'c',name:'설정 테스트반',start_date:'2026-07-15',end_date:'2026-07-22',schedule_days:['wed']},
 students:Array.from({length:2},(_,index)=>({id:`cs${index}`,student_id:`s${index}`,created_at:'2026-01-01',student:{id:`s${index}`,name:`학생${String(index+1).padStart(2,'0')}`}})),
 update:vi.fn(),
}))
vi.mock('@/hooks/use-weeks',()=>({useWeek:()=>({data:fixture.week,isLoading:false}),useWeeks:()=>({data:[fixture.week]}),useUpdateWeek:()=>({isPending:false,mutateAsync:fixture.update})}))
vi.mock('@/hooks/use-classes',()=>({useClass:()=>({data:fixture.cls}),useClassPeriods:()=>({data:[]})}))
vi.mock('@/hooks/use-students',()=>({useClassStudents:()=>({data:fixture.students})}))
vi.mock('@/hooks/use-grade',()=>({useGradeData:()=>({data:{classStudents:fixture.students}})}))
vi.mock('@/components/grade/grade-grid',()=>({GradeGrid:({onOpenAttendance}:{onOpenAttendance:()=>void})=><button onClick={onOpenAttendance}>출결 관리</button>}))
vi.mock('@/components/grade/sms-sheet',()=>({SmsSheet:()=>null}))
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}))

import { useUploadStore, type VocabEntry } from '@/store/upload-store'
import { VOCAB_GRADING_RULES } from '@/lib/prompts'
vi.mock('@/hooks/use-concept-tags',()=>({useConceptCategories:()=>({data:[]}),useConceptTags:()=>({data:[]})}))
vi.mock('@/components/grade/source-image-preview',()=>({SourceImagePreview:()=>null}))
vi.mock('@/components/pdf-import/job-list',()=>({PdfImportJobList:()=>null}))
let client:QueryClient
afterEach(()=>{cleanup();client?.clear();useUploadStore.setState({vocab:{}});vi.unstubAllGlobals();vi.restoreAllMocks()})
it('retains settings edits across tabs, failed saves and retries, and protects closing',async()=>{
 client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false},mutations:{retry:false}}})
 let words:VocabEntry[]=[{id:'v1',number:1,english_word:'apple',correct_answer:'사과',synonyms:[],antonyms:[]},{id:'v2',number:2,english_word:'banana',correct_answer:'바나나',synonyms:[],antonyms:[]}]
 useUploadStore.getState().setVocabSaved('w',words,{type:'ready',savedCount:2})
 let test={id:'t',items:[{vocab_word_id:'v1',sort_order:0,prompt_source:'word',prompt_text:'apple',vocab_word:words[0]}],item_count:1}
 let prompt = VOCAB_GRADING_RULES
 const counts:Record<string,number>={}
 const writes:{url:string;body:unknown}[]=[]
 const questions=[{id:'q',week_id:'w',exam_type:'reading',question_number:1,question_style:'subjective',question_text:'Question',correct_answer_text:'model',grading_criteria:'criteria',explanation:'',is_void:false,all_correct:false}]
 client.setQueryData(['exam-questions','w'],questions)
 const request=vi.fn(async(url:string,init?:RequestInit)=>{
  const write=!!init?.method && init.method!=='GET'
  if(write){
   writes.push({url,body:JSON.parse(String(init.body))});counts[url]=(counts[url]??0)+1
   if(counts[url]===1)return {ok:false,json:async()=>({error:'테스트 저장 실패'})}
   if(url.includes('/prompts/'))prompt=(writes.at(-1)!.body as {content:string}).content
   if(url.endsWith('/vocab-tests')) { const body=writes.at(-1)!.body as {wordIds:string[]};test={...test,item_count:body.wordIds.length,items:body.wordIds.map((id,index)=>({vocab_word_id:id,sort_order:index,prompt_source:'word',prompt_text:words.find(w=>w.id===id)!.english_word,vocab_word:words.find(w=>w.id===id)!}))} }
   if(url.endsWith('/vocab-words'))words=(writes.at(-1)!.body as {words:VocabEntry[]}).words
  }
  const data=url.endsWith('/vocab-words')?(write?{saved:2}:words):url.endsWith('/vocab-tests')?{activeTest:test,gradedCount:0}:url.includes('/prompts/')?{content:prompt}:url.endsWith('/answer-review')?[]:url.endsWith('/exam-questions')?questions:[]
  return {ok:true,json:async()=>data}
 })
 vi.stubGlobal('fetch',request)
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 fixture.update.mockReset().mockRejectedValueOnce(new Error('기본 저장 실패')).mockResolvedValue({})
 await act(async()=>{render(<QueryClientProvider client={client}><Suspense fallback={<p>loading</p>}><WeekDetailPage params={Promise.resolve({classId:'c',weekId:'w'})}/></Suspense></QueryClientProvider>)})
 fireEvent.click(screen.getByRole('button',{name:'설정'}))
 fireEvent.change(screen.getByLabelText('숙제 총 개수'),{target:{value:'3'}})
 fireEvent.click(screen.getByRole('tab',{name:/단어 시험/}))
 await screen.findByText('단어장 2개')
 fireEvent.click(screen.getByRole('tab',{name:/기본 정보/}))
 expect((screen.getByLabelText('숙제 총 개수') as HTMLInputElement).value).toBe('3')
 fireEvent.click(screen.getByRole('button',{name:'기본 정보 저장'}))
 await screen.findByText(/기본 저장 실패/)
 expect((screen.getByLabelText('숙제 총 개수') as HTMLInputElement).value).toBe('3')
 fireEvent.click(screen.getByRole('button',{name:'기본 정보 저장'}))
 await waitFor(()=>expect(fixture.update).toHaveBeenCalledTimes(2))
 fireEvent.click(screen.getByRole('tab',{name:/단어 시험/}))
 fireEvent.click(screen.getByRole('button',{name:/단어 직접 수정/}))
 fireEvent.change(screen.getByDisplayValue('사과'),{target:{value:'사과 수정'}})
 fireEvent.click(screen.getByRole('tab',{name:/문항·정답/}))
 fireEvent.click(screen.getByRole('tab',{name:/단어 시험/}))
 expect(screen.getByDisplayValue('사과 수정')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'설정 닫기'}))
 expect(confirm).toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}))
 await screen.findByText(/테스트 저장 실패.*입력은 유지/)
 expect(screen.getByDisplayValue('사과 수정')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}))
 await waitFor(()=>expect(screen.getByText('단어장 변경 없음')).toBeTruthy())
 const wordWrites=writes.filter(row=>row.url.endsWith('/vocab-words'))
 expect(wordWrites).toHaveLength(2);expect(wordWrites[1]).toEqual(wordWrites[0])
 fireEvent.click(screen.getByRole('checkbox',{name:/banana/}))
 fireEvent.click(screen.getByRole('tab',{name:/기본 정보/}))
 fireEvent.click(screen.getByRole('tab',{name:/단어 시험/}))
 expect((screen.getByRole('checkbox',{name:/banana/}) as HTMLInputElement).checked).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'시험 구성 저장 · 2문항'}))
 await waitFor(()=>expect(counts['/api/weeks/w/vocab-tests']).toBe(1))
 await waitFor(()=>expect((screen.getByRole('button',{name:'시험 구성 저장 · 2문항'}) as HTMLButtonElement).disabled).toBe(false))
 expect((screen.getByRole('checkbox',{name:/banana/}) as HTMLInputElement).checked).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'시험 구성 저장 · 2문항'}))
 await waitFor(()=>expect(counts['/api/weeks/w/vocab-tests']).toBe(2))
 expect(writes.filter(row=>row.url.endsWith('/vocab-tests'))[1]).toEqual(writes.filter(row=>row.url.endsWith('/vocab-tests'))[0])
 fireEvent.click(screen.getByRole('button',{name:/채점 규칙 수정/}))
 fireEvent.change(screen.getByDisplayValue(/당신은 영어학원의 단어시험/),{target:{value:'teacher rules'}})
 act(()=>client.setQueryData(['prompt','vocab_grading_rules'],'background rules'))
 fireEvent.click(screen.getByRole('tab',{name:/기본 정보/}))
 fireEvent.click(screen.getByRole('tab',{name:/단어 시험/}))
 expect(screen.getByDisplayValue('teacher rules')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'채점 규칙 저장'}))
 await waitFor(()=>expect(counts['/api/prompts/vocab_grading_rules']).toBe(1))
 await waitFor(()=>expect((screen.getByRole('button',{name:'채점 규칙 저장'}) as HTMLButtonElement).disabled).toBe(false))
 expect(screen.getByDisplayValue('teacher rules')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'채점 규칙 저장'}))
 await waitFor(()=>expect(counts['/api/prompts/vocab_grading_rules']).toBe(2))
 fireEvent.click(screen.getByRole('tab',{name:/문항·정답/}))
 fireEvent.click(screen.getByRole('button',{name:'상세 수정'}))
 fireEvent.change(screen.getByDisplayValue('model'),{target:{value:'new model'}})
 fireEvent.click(screen.getByRole('tab',{name:/시험 자료/}))
 fireEvent.click(screen.getByRole('tab',{name:/문항·정답/}))
 expect(screen.getByDisplayValue('new model')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'문항 정보 저장'}))
 await waitFor(()=>expect(counts['/api/weeks/w/questions']).toBe(1))
 await waitFor(()=>expect((screen.getByRole('button',{name:'문항 정보 저장'}) as HTMLButtonElement).disabled).toBe(false))
 expect(screen.getByDisplayValue('new model')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'문항 정보 저장'}))
 await waitFor(()=>expect(counts['/api/weeks/w/questions']).toBe(2))
 expect(writes.filter(row=>row.url.endsWith('/questions'))[1]).toEqual(writes.filter(row=>row.url.endsWith('/questions'))[0])
 fireEvent.click(screen.getByRole('tab',{name:/시험 자료/}))
 const pdf = new File(['test PDF'],'qa.pdf',{type:'application/pdf'})
 fireEvent.change(document.querySelector('input[accept="application/pdf"]')!,{target:{files:[pdf]}})
 fireEvent.click(screen.getByRole('tab',{name:/기본 정보/}))
 fireEvent.click(screen.getByRole('tab',{name:/시험 자료/}))
 expect(screen.getByText('qa.pdf')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'설정 닫기'}))
 expect(screen.getByRole('dialog')).toBeTruthy()
 expect(confirm).toHaveBeenLastCalledWith('설정에 저장하지 않은 변경이 있습니다. 변경을 버리고 닫을까요?')
 expect(writes.every(row=>!row.url.includes('/grade')&&!row.url.includes('/share'))).toBe(true)
},30000)


import { VocabWordSetup } from '@/components/grade/vocab-word-setup'
it('keeps a graded vocabulary test locked and preserves its saved order',async()=>{
 client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}})
 const word:VocabEntry={id:'v',number:1,english_word:'apple',correct_answer:'사과',synonyms:[],antonyms:[]}
 useUploadStore.getState().setVocabSaved('w',[word],{type:'ready',savedCount:1})
 const request=vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes('/prompts/')?{content:VOCAB_GRADING_RULES}:{gradedCount:2,activeTest:{id:'t',item_count:1,items:[{vocab_word_id:'v',sort_order:0,prompt_source:'word',prompt_text:'apple',vocab_word:word}]}}}))
 vi.stubGlobal('fetch',request)
 render(<QueryClientProvider client={client}><VocabWordSetup weekId="w"/></QueryClientProvider>)
 expect(await screen.findByText('시험지 잠김')).toBeTruthy()
 expect(screen.queryByRole('button',{name:/시험 구성 저장/})).toBeNull()
 expect((screen.getByRole('checkbox',{name:/apple/}) as HTMLInputElement).disabled).toBe(true)
 expect(screen.getByRole('button',{name:'시험지 인쇄'})).toBeTruthy()
 expect(request.mock.calls.every(([url])=>!url.includes('/grade'))).toBe(true)
})


it('automatically selects and saves, preserves failed selection and retries the same configuration before printing',async()=>{
 client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false},mutations:{retry:false}}})
 const words:VocabEntry[]=['apple','banana','carrot'].map((english_word,index)=>({id:`v${index}`,number:index+1,english_word,correct_answer:'뜻',synonyms:[],antonyms:[]}))
 useUploadStore.getState().setVocabSaved('w',words,{type:'ready',savedCount:3})
 let items=[{vocab_word_id:'v0',sort_order:0,prompt_source:'word',prompt_text:'apple',vocab_word:words[0]}]
 let testId='old-test'
 const writes:unknown[]=[]
 const request=vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){
   const body=JSON.parse(String(init.body));writes.push(body)
   if(writes.length===1)return {ok:false,json:async()=>({error:'테스트 저장 실패'})}
   testId='new-test';items=body.items.map((item:{wordId:string;promptText:string},index:number)=>({vocab_word_id:item.wordId,sort_order:index,prompt_source:'word',prompt_text:item.promptText,vocab_word:words.find(w=>w.id===item.wordId)!}))
   return {ok:true,json:async()=>({ok:true,test:{id:testId}})}
  }
  return {ok:true,json:async()=>url.includes('/prompts/')?{content:VOCAB_GRADING_RULES}:{gradedCount:0,activeTest:{id:testId,item_count:items.length,items}}}
 })
 vi.stubGlobal('fetch',request)
 const windows:{document:{title:string;body:{textContent:string}},location:{href:string},closed:boolean,close:ReturnType<typeof vi.fn>}[]=[]
 vi.spyOn(window,'open').mockImplementation(()=>{const handle={document:{title:'',body:{textContent:''}},location:{href:''},closed:false,close:vi.fn()};windows.push(handle);return handle as unknown as Window})
 render(<QueryClientProvider client={client}><VocabWordSetup weekId="w"/></QueryClientProvider>)
 await screen.findByText('1문항 저장됨')
 fireEvent.click(screen.getByRole('button',{name:'자동 출제·저장'}))
 await screen.findByRole('alert')
 expect(writes).toHaveLength(1)
 expect(windows).toHaveLength(0)
 expect(screen.getAllByRole('checkbox').every(box=>(box as HTMLInputElement).checked)).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'저장 후 인쇄'}))
 await waitFor(()=>expect(windows[0].location.href).toContain('/vocab-test/new-test/print'))
 expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0])
 expect(windows.every(handle=>!handle.location.href.includes('old-test'))).toBe(true)
})


it('keeps word save separate from visible example action and retries only unfinished work',async()=>{
 client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false},mutations:{retry:false}}})
 let words:VocabEntry[]=['apple','banana','carrot'].map((english_word,index)=>({id:`v${index}`,number:index+1,english_word,correct_answer:'뜻',synonyms:[],antonyms:[],example_sentence:index===0?'Existing apple.':null}))
 useUploadStore.getState().setVocabSaved('w',words,{type:'ready',savedCount:3})
 let generation=0
 const targets:string[][]=[]
 let finishFirst:()=>void=()=>{}
 const firstBatch=new Promise<void>(resolve=>{finishFirst=resolve})
 const request=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.includes('regen-examples')){
   expect(url.endsWith('?batch=1')).toBe(true)
   generation++;targets.push(words.filter(w=>!w.example_sentence).map(w=>w.id!))
   if(generation===1){await firstBatch;words=words.map(w=>w.id==='v1'?{...w,example_sentence:'New banana.'}:w);return {ok:true,json:async()=>({saved:1,missing:2,remaining:1,incomplete:false})}}
   if(generation===2)return {ok:false,json:async()=>({error:'연결 실패'})}
   words=words.map(w=>w.id==='v2'?{...w,example_sentence:'New carrot.'}:w)
   return {ok:true,json:async()=>({saved:1,missing:1,remaining:0,incomplete:false})}
  }
  if(url.endsWith('/vocab-words')){
   if(init?.method==='POST'){words=JSON.parse(String(init.body)).words;return {ok:true,json:async()=>({saved:3})}}
   return {ok:true,json:async()=>words}
  }
  return {ok:true,json:async()=>url.includes('/prompts/')?{content:VOCAB_GRADING_RULES}:{activeTest:null,gradedCount:0}}
 })
 vi.stubGlobal('fetch',request)
 render(<QueryClientProvider client={client}><VocabWordSetup weekId="w"/></QueryClientProvider>)
 fireEvent.click(screen.getByRole('button',{name:/단어 직접 수정/}))
 fireEvent.change(screen.getAllByDisplayValue('뜻')[0],{target:{value:'수정된 뜻'}})
 expect((screen.getByRole('button',{name:/예문 생성 · /}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'단어장 저장'}))
 await waitFor(()=>expect(screen.getByText('단어장 변경 없음')).toBeTruthy())
 expect((screen.getByRole('button',{name:/예문 생성 · /}) as HTMLButtonElement).disabled).toBe(false)
 expect(generation).toBe(0)
 fireEvent.click(screen.getByRole('button',{name:/예문 생성 · /}))
 expect(await screen.findByText(/AI 예문 생성 중/)).toBeTruthy()
 expect(screen.getByRole('progressbar',{name:'예문 생성 진행률'})).toBeTruthy()
 await act(async()=>{finishFirst()})
 expect(await screen.findByText(/연결 실패/)).toBeTruthy()
 expect(words[0].example_sentence).toBe('Existing apple.')
 expect(words[1].example_sentence).toBe('New banana.')
 fireEvent.click(screen.getByRole('button',{name:/예문 재시도 · /}))
 await waitFor(()=>expect(generation).toBe(3))
 await waitFor(()=>expect(screen.queryByRole('progressbar')).toBeNull())
 expect(targets).toEqual([['v1','v2'],['v2'],['v2']])
 expect(words[0].example_sentence).toBe('Existing apple.')
 expect(words.every(w=>!!w.example_sentence)).toBe(true)
 expect(request.mock.calls.every(([url])=>!url.includes('/grade')&&!url.includes('/share'))).toBe(true)
})
