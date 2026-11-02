import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import type { TeacherTransaction } from '@/lib/db/transaction'

const state=vi.hoisted(()=>({db:null as PGlite|null,ai:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/api',()=>({
 getAuth:async()=>({user:{id:'user'},supabase:{from:(table:string)=>{
 const filters:Record<string,unknown>={}
 const query={select:()=>query,eq:(key:string,value:unknown)=>{filters[key]=value;return query},
 then:(resolve:(value:unknown)=>unknown)=>Promise.resolve().then(async()=>({error:null,data:(await state.db!.query(`select * from ${table} where week_id=$1${filters.exam_type?' and exam_type=$2':''}`,filters.exam_type?[filters.week_id,filters.exam_type]:[filters.week_id])).rows})).then(resolve),
 upsert:async(rows:{class_id:string;student_id:string;date:string;status:string;note:string|null}[])=>{for(const row of rows)await state.db!.query('insert into attendance(class_id,student_id,date,status,note) values($1,$2,$3,$4,$5) on conflict(class_id,student_id,date) do update set status=excluded.status,note=excluded.note',[row.class_id,row.student_id,row.date,row.status,row.note]);return {error:null}}}
 return query
 }}}),
 getTeacherId:async()=>'teacher',assertWeekOwner:async()=>true,assertClassOwner:async()=>true,
 ok:(value:unknown)=>Response.json(value),err:(error:string,status=400)=>Response.json({error},{status}),
}))
vi.mock('@/lib/anthropic',()=>({gradeSubjectiveAnswers:state.ai}))
vi.mock('@/lib/db/transaction',async importOriginal=>({...await importOriginal<typeof import('@/lib/db/transaction')>(),withTeacherTransaction:async(_user:string,work:(context:TeacherTransaction)=>Promise<unknown>)=>{
 const {drizzle}=await import('drizzle-orm/pglite')
 return drizzle(state.db!).transaction(tx=>work({teacherId:'00000000-0000-4000-8000-000000000001',tx:tx as unknown as TeacherTransaction['tx']}))
}}))
import { captureGradeVersions } from '@/lib/services/grade-save'
import { POST } from '@/app/api/weeks/[id]/grade/route'
import { POST as saveAttendance } from '@/app/api/classes/[id]/attendance/route'
const week='00000000-0000-4000-8000-000000000031'
const student='00000000-0000-4000-8000-000000000041'
const second='00000000-0000-4000-8000-000000000042'
const third='00000000-0000-4000-8000-000000000043'
const question='00000000-0000-4000-8000-000000000061'
const score='00000000-0000-4000-8000-000000000071'
const otherScore='00000000-0000-4000-8000-000000000072'
const base={student_id:student,present:true,reading_present:true,reading_correct:0,vocab_correct:0,homework_done:2.5,memo:'keep',answers:[{exam_question_id:question,student_answer:1,student_answer_text:null}]}
async function send(rows:Record<string,unknown>[],draft=false){const versions=await captureGradeVersions('user',week,rows.map(row=>String(row.student_id)));rows=rows.map(row=>({...row,grade_version:versions.find(version=>version.student_id===row.student_id)}));return POST(new Request('http://localhost/grade',{method:'POST',body:JSON.stringify({rows,skip_ai:draft,draft_only:draft})}),{params:Promise.resolve({id:week})})}
beforeAll(async()=>{
 state.db=new PGlite()
 await state.db.exec(readFileSync('tests/fixtures/transaction-schema.sql','utf8'))
 await state.db.exec(readFileSync('tests/fixtures/compound-transaction-schema.sql','utf8'))
 await state.db.exec(`insert into week(id,class_id,week_number,reading_total) values('${week}','00000000-0000-4000-8000-000000000021',1,1);
 insert into student(id,teacher_id,name) values('${student}','00000000-0000-4000-8000-000000000001','absent zero'),('${second}','00000000-0000-4000-8000-000000000001','unattempted'),('${third}','00000000-0000-4000-8000-000000000001','new');
 insert into class_student(class_id,student_id) values('00000000-0000-4000-8000-000000000021','${student}'),('00000000-0000-4000-8000-000000000021','${second}'),('00000000-0000-4000-8000-000000000021','${third}');
 insert into exam_question(id,week_id,question_number,exam_type,question_style,correct_answer) values('${question}','${week}',1,'reading','objective',2);
 insert into week_score(id,week_id,student_id,reading_correct,homework_done,memo) values('${score}','${week}','${student}',0,2.5,'keep'),('${otherScore}','${week}','${second}',null,3.5,'retain old answer');
 insert into student_answer(week_score_id,exam_question_id,student_answer,is_correct) values('${score}','${question}',1,false),('${otherScore}','${question}',2,true);
 create table attendance(class_id uuid default '00000000-0000-4000-8000-000000000021',student_id uuid,date date default '2026-04-08',status text,note text,unique(class_id,student_id,date));insert into attendance(student_id,status) values('${student}','absent'),('${second}','absent'),('${third}','present');`)
},30_000)
afterAll(async()=>{await state.db?.close()})
it('full grading and background saving preserve absent students, unattempted null and genuine zero in PostgreSQL',async()=>{
 const rows=[base,{...base,student_id:second,reading_present:false,reading_correct:null,homework_done:3.5,memo:'retain old answer',answers:[]},{...base,student_id:third,reading_present:false,reading_correct:null,homework_done:null,memo:'',answers:[]}]
 for(const draft of [false,true]){
  const response=await send(rows,draft)
  expect(response.status,JSON.stringify(await response.json())).toBe(200)
  const grades=(await state.db!.query<{student_id:string;reading_correct:string|null}>('select student_id,reading_correct::text from week_score order by student_id')).rows
  expect(grades.map(row=>row.reading_correct)).toEqual(['0',null,null])
  const answers=(await state.db!.query('select week_score_id,student_answer,is_correct from student_answer order by week_score_id')).rows
  expect(answers).toEqual([{week_score_id:score,student_answer:1,is_correct:false},{week_score_id:otherScore,student_answer:2,is_correct:true}])
 }
 expect(state.ai).not.toHaveBeenCalled()
})
it('an old client exclusion cannot delete a stored score or its cascading answers',async()=>{
 const scores=(await state.db!.query('select * from week_score order by id')).rows
 const answers=(await state.db!.query('select * from student_answer order by id')).rows
 const response=await send([{...base,present:false,reading_correct:null,homework_done:null,memo:'',answers:[]}])
 expect(response.status).toBe(200)
 expect((await state.db!.query('select * from week_score order by id')).rows).toEqual(scores)
 expect((await state.db!.query('select * from student_answer order by id')).rows).toEqual(answers)
})

it('changing class attendance through the actual attendance route never touches scores or answers',async()=>{
 const scores=(await state.db!.query('select * from week_score order by id')).rows
 const answers=(await state.db!.query('select * from student_answer order by id')).rows
 for(const status of ['present','absent']){
  const response=await saveAttendance(new Request('http://localhost/attendance',{method:'POST',body:JSON.stringify({date:'2026-04-08',records:[{student_id:student,status,note:'attendance only'}]})}),{params:Promise.resolve({id:'00000000-0000-4000-8000-000000000021'})})
  expect(response.status).toBe(200)
 }
 expect((await state.db!.query('select status from attendance where student_id=$1',[student])).rows).toEqual([{status:'absent'}])
 expect((await state.db!.query('select * from week_score order by id')).rows).toEqual(scores)
 expect((await state.db!.query('select * from student_answer order by id')).rows).toEqual(answers)
})

it('preserves an explicitly entered zero even without any answer rows',async()=>{
 const response=await send([{...base,student_id:third,reading_present:true,reading_correct:0,answers:[]}])
 expect(response.status).toBe(200)
 expect((await state.db!.query('select reading_correct::text from week_score where student_id=$1',[third])).rows).toEqual([{reading_correct:'0'}])
})

it('AI-grades an absent participant and retains a genuine zero in PostgreSQL',async()=>{
 await state.db!.query("update exam_question set question_style='subjective',correct_answer_text='model' where id=$1",[question])
 state.ai.mockResolvedValue([{week_score_id:score,exam_question_id:question,is_correct:false,needs_review:false,ai_feedback:'wrong answer'}])
 const response=await send([{...base,answers:[{exam_question_id:question,student_answer:null,student_answer_text:'wrong'}]}])
 expect(response.status,JSON.stringify(await response.json())).toBe(200)
 expect(state.ai).toHaveBeenCalledOnce()
 expect((await state.db!.query('select reading_correct::text from week_score where id=$1',[score])).rows).toEqual([{reading_correct:'0'}])
 expect((await state.db!.query('select student_answer_text,is_correct from student_answer where week_score_id=$1',[score])).rows).toEqual([{student_answer_text:'wrong',is_correct:false}])
 expect((await state.db!.query('select status from attendance where student_id=$1',[student])).rows).toEqual([{status:'absent'}])
})
