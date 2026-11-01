import {beforeEach,it,expect,vi} from 'vitest'
import {PgDialect} from 'drizzle-orm/pg-core'
import {POST,GET} from '@/app/api/weeks/[id]/grade/route'
import {POST as photoGrade} from '@/app/api/weeks/[id]/grade-vocab-photo/route'
import {POST as regrade,PATCH as editAnswer} from '@/app/api/vocab-answer/route'
import {SaveError} from '@/lib/db/errors'
const m=vi.hoisted(()=>({save:vi.fn(),ai:vi.fn(),vocab:vi.fn(),meaning:vi.fn(),capture:vi.fn(),versions:vi.fn(),from:vi.fn(),upload:vi.fn(),info:vi.fn(),readError:'',missing:false,locked:false}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/api',()=>({getAuth:async()=>({user:{id:'user'},supabase:{from:m.from,storage:{from:()=>({upload:m.upload,info:m.info})}}}),getTeacherId:async()=>'teacher',assertWeekOwner:async()=>true,err:(error:string,status=400)=>Response.json({error},{status}),ok:(data:unknown)=>Response.json(data)}))
vi.mock('@/lib/anthropic',()=>({gradeSubjectiveAnswers:m.ai,gradeVocabPhoto:m.vocab,gradeVocabItems:m.meaning}))
vi.mock('@/lib/services/week-save',()=>({captureWeekVersion:m.capture,readingTotals:()=>[]}))
vi.mock('@/lib/services/grade-save',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/services/grade-save')>(),saveGradePlan:m.save,captureGradeVersions:m.versions}))
const week='00000000-0000-4000-8000-000000000031',student='00000000-0000-4000-8000-000000000041',question='00000000-0000-4000-8000-000000000061',score='00000000-0000-4000-8000-000000000051'
const hash='a'.repeat(64),grade_version={score_id:null,revision:hash}
const body=[{grade_version,student_id:student,student_name:'synthetic',present:true,vocab_correct:null,reading_present:true,reading_correct:0,homework_done:null,memo:'',answers:[{exam_question_id:question,student_answer:null,student_answer_text:'answer'}]}]
const args={params:Promise.resolve({id:week})}
const request=(value:unknown,method='POST')=>new Request('http://localhost/test',{method,body:JSON.stringify(value)})
const invoke=(value:unknown=body)=>POST(request(value),args)
beforeEach(()=>{
 vi.clearAllMocks();m.readError='';m.missing=false;m.locked=false
 m.versions.mockResolvedValue([{student_id:student,...grade_version}]);m.capture.mockResolvedValue(hash);m.upload.mockResolvedValue({error:null});m.info.mockResolvedValue({data:{size:10},error:null})
 m.save.mockImplementation(async(_user,_week,_version,_statements,ids:string[])=>({ok:true,versions:ids.map(student_id=>({student_id,score_id:null,revision:'b'.repeat(64)}))}))
 m.ai.mockImplementation(async(_questions,answers)=>[{week_score_id:answers[0].week_score_id,exam_question_id:question,is_correct:true,needs_review:false,ai_feedback:'correct'}])
 m.vocab.mockResolvedValue([1,2].map(number=>({number,english_word:'word'+number,student_answer:'answer',is_correct:true})))
 m.meaning.mockResolvedValue([{number:1,english_word:'word1',student_answer:'answer',is_correct:true}])
 m.from.mockImplementation((table:string)=>{
  let columns='';const filters:Record<string,unknown>={}
  const data=()=>{
   if(table==='week')return [{id:week,class_id:'class',start_date:null,vocab_source_type:'legacy'}]
   if(table==='class_student')return [{student_id:student,student:{name:'synthetic'}}]
   if(table==='week_score')return [{id:score,student_id:student,exam_photo_path:'old-photo',student_answer:[],student_vocab_answer:[]}]
   if(table==='exam_question')return m.missing?[]:[{id:question,week_id:week,question_number:1,sub_label:null,question_style:'subjective',correct_answer_text:'answer',grading_criteria:null}]
   if(table==='vocab_word')return [1,2].map(number=>({id:`00000000-0000-4000-8000-00000000007${number}`,number,english_word:'word'+number,correct_answer:'answer'}))
   if(table==='student_vocab_answer'){
    if(columns.includes('week_score('))return [{id:'answer',week_score_id:score,week_score:{week_id:week,student_id:student}}]
    if(filters.teacher_locked)return m.locked?[{vocab_word_id:'00000000-0000-4000-8000-000000000071',is_correct:false,student_answer:'locked',test_number:1}]:[]
    return [{id:'answer',teacher_locked:m.locked,test_number:1,test_source:'word',vocab_word_id:'00000000-0000-4000-8000-000000000071',vocab_word:{english_word:'word1',correct_answer:'answer',example_sentence:null},vocab_word_variant:null}]
   }
   return []
  }
  const result=(single=false)=>({data:single?data()[0]??null:data(),error:m.readError===table?{message:'injected'}:null})
  const q={select:(s:string)=>{columns=s;return q},eq:(k:string,v:unknown)=>{filters[k]=v;return q},in:()=>q,lte:()=>q,or:()=>q,is:()=>q,order:()=>q,limit:()=>q,single:async()=>result(true),maybeSingle:async()=>result(true),then:(resolve:(value:ReturnType<typeof result>)=>unknown)=>Promise.resolve(result()).then(resolve)}
  return q
 })
})
it('runs AI before the sole production transaction and plans score/answer together',async()=>{
 expect((await invoke()).status).toBe(200);expect(m.ai).toHaveBeenCalledOnce();expect(m.save).toHaveBeenCalledOnce()
 const [userId,weekId,version,statements,students]=m.save.mock.calls[0]
 expect([userId,weekId,version,students]).toEqual(['user',week,{[student]:hash},[student]])
 const dialect=new PgDialect();const queries=statements.map((s:{query:Parameters<PgDialect['sqlToQuery']>[0]})=>dialect.sqlToQuery(s.query).sql)
 expect(queries.some((s:string)=>s.includes('insert into "public"."week_score"'))).toBe(true)
 expect(queries.some((s:string)=>s.includes('insert into "public"."student_answer"'))).toBe(true)
})
it('leaves the entire previous grade untouched when AI fails or omits a result',async()=>{
 m.ai.mockRejectedValueOnce(new Error('synthetic failure'));expect((await invoke()).status).toBe(503);expect(m.save).not.toHaveBeenCalled()
 m.ai.mockResolvedValue([]);expect((await invoke()).status).toBe(503);expect(m.save).not.toHaveBeenCalled()
})
it('rejects stale displayed versions before AI and concurrent changes at commit',async()=>{
 expect((await invoke([{...body[0],grade_version:{score_id:null,revision:'c'.repeat(64)}}])).status).toBe(409);expect(m.ai).not.toHaveBeenCalled()
 m.save.mockRejectedValue(new SaveError('changed',409));expect((await invoke()).status).toBe(409);expect(m.ai).toHaveBeenCalledOnce()
})
it('rejects foreign question identifiers before AI or persistence',async()=>{
 m.missing=true;expect((await invoke()).status).toBe(403);expect(m.ai).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled()
})
it('does not return empty successful grades on a read failure or attach a newer token to older data',async()=>{
 m.readError='exam_question';expect((await GET(new Request('http://localhost'),args)).status).toBe(503)
 m.readError='';m.versions.mockRejectedValueOnce(new SaveError('changed',409));expect((await GET(new Request('http://localhost'),args)).status).toBe(409)
})
it('requires a confirmed nonempty photo before vocabulary AI starts',async()=>{
 m.upload.mockResolvedValueOnce({error:{message:'failed'}})
 expect((await photoGrade(request({studentId:student,fileData:'YQ==',mimeType:'image/jpeg'}),args)).status).toBe(503);expect(m.vocab).not.toHaveBeenCalled()
 m.info.mockResolvedValue({data:{size:0},error:null})
 expect((await photoGrade(request({studentId:student,fileData:'YQ==',mimeType:'image/jpeg'}),args)).status).toBe(503);expect(m.vocab).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled()
})
it('rejects partial or duplicate vocabulary results without a transaction',async()=>{
 for(const results of [[{number:1,english_word:'word1',is_correct:true}],[{number:1,english_word:'word1'},{number:1,english_word:'word1'}]]){
  m.vocab.mockResolvedValueOnce(results)
  expect((await photoGrade(request({studentId:student,fileData:'YQ==',mimeType:'image/jpeg'}),args)).status).toBe(422)
 }
 expect(m.save).not.toHaveBeenCalled()
})
it('rejects non-boolean verdicts and invalid numbers instead of counting truthy strings as correct',async()=>{
 for (const result of [{number:0,english_word:'word1',is_correct:true},{number:1,english_word:'word1',is_correct:'false'}]) {
  m.vocab.mockResolvedValueOnce([result,{number:2,english_word:'word2',is_correct:true}])
  expect((await photoGrade(request({studentId:student,fileData:'YQ==',mimeType:'image/jpeg'}),args)).status).toBe(422)
 }
 m.meaning.mockResolvedValue([{number:1,english_word:'word1',student_answer:'answer',is_correct:'false'}])
 expect((await regrade(request({weekScoreId:score,grade_version,items:[{id:'answer',number:1,english_word:'word1',student_answer:'answer'}]})))?.status).toBe(422)
 expect(m.save).not.toHaveBeenCalled()
})
it('commits complete vocabulary answers/totals/photo together and preserves teacher decisions',async()=>{
 m.locked=true
 const response=await photoGrade(request({studentId:student,fileData:'YQ==',mimeType:'image/jpeg'}),args)
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({vocab_correct:1,vocab_total:2})
 expect(m.save).toHaveBeenCalledOnce()
 const dialect=new PgDialect();const plans=m.save.mock.calls[0][3].map((s:{query:Parameters<PgDialect['sqlToQuery']>[0]})=>dialect.sqlToQuery(s.query))
 expect(JSON.stringify(plans)).toContain('vocab_photo_path');expect(JSON.stringify(plans)).toContain('locked')
})
it('requires screen versions on manual edits and refuses AI edits of teacher locks',async()=>{
 expect((await editAnswer(request({id:'answer',student_answer:'new'},'PATCH')))?.status).toBe(409)
 m.locked=true
 expect((await regrade(request({weekScoreId:score,grade_version,items:[{id:'answer',number:1,english_word:'word1',student_answer:'answer'}]})))?.status).toBe(409)
 expect(m.meaning).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled()
})
