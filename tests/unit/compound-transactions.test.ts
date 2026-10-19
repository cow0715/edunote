import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { sql } from 'drizzle-orm'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { executeStatements, insertRows, updateRows, deleteRows } from '@/lib/db/statements'
import { replaceVocabTest } from '@/lib/services/vocab-tests'
import { registerStudent, enrollStudent, changeEnrollment } from '@/lib/services/students'
import { confirmGrades } from '@/lib/services/grade-confirm'
import { saveMockResult, captureMockInputs } from '@/lib/services/mock-results'
import { replaceMockQuestions, createMockExam } from '@/lib/services/mock-questions'
import { editQuestions } from '@/lib/services/questions'
import { publishMockReports } from '@/lib/services/mock-reports'
import { applyWeekPlan, weekVersion, readingTotals } from '@/lib/services/week-save'

vi.mock('server-only', () => ({}))
const teacher = '00000000-0000-4000-8000-000000000001'
const user = '00000000-0000-4000-8000-000000000011'
const cls = '00000000-0000-4000-8000-000000000021'
const otherClass = '00000000-0000-4000-8000-000000000022'
const week = '00000000-0000-4000-8000-000000000031'
const otherWeek = '00000000-0000-4000-8000-000000000032'
const student = '00000000-0000-4000-8000-000000000041'
const foreignStudent = '00000000-0000-4000-8000-000000000042'
const word = '00000000-0000-4000-8000-000000000051'
const question = '00000000-0000-4000-8000-000000000061'
const score = '00000000-0000-4000-8000-000000000071'
const exam = '00000000-0000-4000-8000-000000000081'
const mockQuestion = '00000000-0000-4000-8000-000000000091'

describe('compound saves on PostgreSQL with the actual role migration', () => {
  let db: PGlite
  let orm: ReturnType<typeof drizzle>
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(readFileSync('tests/fixtures/transaction-schema.sql','utf8'))
    await db.exec(readFileSync('tests/fixtures/compound-transaction-schema.sql','utf8'))
    for (const table of ['student','class_student','clinic_enrollment','clinic_slot','exam_question','vocab_word','vocab_word_variant','week_score','student_answer','student_vocab_answer','vocab_test','vocab_test_item','mock_exam','mock_exam_question','mock_exam_result','mock_exam_student_answer','mock_exam_report','concept_tag','exam_question_tag']) {
      await db.exec(`create policy dev_allow on ${table} for all using(true) with check(true)`)
    }
    await db.exec(readFileSync('supabase/migrations/20260929101449_server_transaction_role.sql','utf8'))
    await db.exec(readFileSync('supabase/migrations/20261019000002_expand_transaction_writes.sql','utf8'))
    await db.exec(`insert into week(id,class_id,week_number) values('${week}','${cls}',1),('${otherWeek}','${otherClass}',1);
      insert into student(id,teacher_id,name) values('${student}','${teacher}','own'),('${foreignStudent}','00000000-0000-4000-8000-000000000002','other');
      insert into class_student(class_id,student_id,joined_at) values('${cls}','${student}','2026-01-01');
      insert into vocab_word(id,week_id,number,english_word) values('${word}','${week}',1,'word');
      insert into exam_question(id,week_id,question_number,exam_type) values('${question}','${week}',1,'reading');
      insert into week_score(id,week_id,student_id) values('${score}','${week}','${student}');
      insert into student_answer(week_score_id,exam_question_id,is_correct) values('${score}','${question}',false);
      insert into mock_exam(id,teacher_id,title,exam_year,exam_month) values('${exam}','${teacher}','mock',2026,10);
      insert into mock_exam_question(id,mock_exam_id,question_number,correct_answer) values('${mockQuestion}','${exam}',1,'2');`)
    await db.exec(`insert into clinic_slot(id,teacher_id) values('00000000-0000-4000-8000-000000000099','${teacher}')`)
    orm = drizzle(db)
  }, 30_000)
  afterAll(async () => { await db?.close() })
  const run = <T>(work: (context: TeacherTransaction) => Promise<T>) => orm.transaction(async tx => {
    await tx.execute(sql`set local role edunote_app`)
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({sub:user})}, true)`)
    return work({ tx: tx as unknown as TeacherTransaction['tx'], teacherId: teacher })
  })

  it('rolls back test deactivation and totals when item insertion fails', async () => {
    const old = await run(c => replaceVocabTest(c, week, 'old', [{wordId:word,variantId:null,promptSource:'word',promptText:'word'}]))
    await db.exec(`create function fail_item() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$;
      create trigger fail_item before insert on vocab_test_item for each row execute function fail_item();`)
    await expect(run(c => replaceVocabTest(c,week,'new',[{wordId:word,variantId:null,promptSource:'word',promptText:'new'}]))).rejects.toThrow()
    expect((await db.query('select id,is_active from vocab_test')).rows).toEqual([{id:old.id,is_active:true}])
    expect((await db.query('select vocab_total from week where id=$1',[week])).rows).toEqual([{vocab_total:1}])
    await db.exec('drop trigger fail_item on vocab_test_item')
  })

  it('checks graded lock under the same transaction before replacing tests', async () => {
    await db.exec(`insert into student_vocab_answer(week_score_id,vocab_word_id) values('${score}','${word}')`)
    await expect(run(c => replaceVocabTest(c,week,'locked',[{wordId:word,variantId:null,promptSource:'word',promptText:'word'}]))).rejects.toMatchObject({status:409})
    await db.exec('delete from student_vocab_answer')
  })

  it('keeps manual numeric scores on identical reprints and clears them on a changed selection',async()=>{
    await db.exec(`update week_score set vocab_correct=1 where id='${score}'`)
    await run(c=>replaceVocabTest(c,week,'reprint',[{wordId:word,variantId:null,promptSource:'word',promptText:'word'}]))
    expect((await db.query('select vocab_correct from week_score where id=$1',[score])).rows).toEqual([{vocab_correct:1}])
    await run(c=>replaceVocabTest(c,week,'changed',[{wordId:word,variantId:null,promptSource:'word',promptText:'changed'}]))
    expect((await db.query('select vocab_correct from week_score where id=$1',[score])).rows).toEqual([{vocab_correct:null}])
  })

  it('rolls back destructive word replacement and cascaded answers on a later failure', async () => {
    await db.exec(`insert into student_vocab_answer(week_score_id,vocab_word_id,teacher_locked,retake_answer) values('${score}','${word}',true,'retake')`)
    const before = (await db.query('select * from student_vocab_answer')).rows
    const beforeItems = (await db.query('select * from vocab_test_item order by id')).rows
    const version = await run(c => weekVersion(c,week))
    await expect(run(c => applyWeekPlan(c,week,version,[deleteRows('vocab_word',sql`week_id=${week}::uuid`),
      ...insertRows('vocab_word',[{week_id:week,number:1,english_word:null}])]))).rejects.toThrow()
    expect((await db.query('select * from student_vocab_answer')).rows).toEqual(before)
    expect((await db.query('select * from vocab_test_item order by id')).rows).toEqual(beforeItems)
    await db.exec('delete from student_vocab_answer')
  })

  it('rejects stale AI/OCR plans without overwriting a newer grade', async () => {
    const version = await run(c => weekVersion(c,week))
    await db.exec(`update student_answer set teacher_confirmed=true,is_correct=true`)
    await expect(run(c => applyWeekPlan(c,week,version,[updateRows('week_score',{reading_correct:0},sql`id=${score}::uuid`)]))).rejects.toMatchObject({status:409})
    expect((await db.query('select reading_correct from week_score')).rows).toEqual([{reading_correct:null}])
  })

  it('rolls back confirmed answers when updating the aggregate fails, then commits both', async () => {
    await db.exec(`create function fail_total() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$;
      create trigger fail_total before update on week_score for each row execute function fail_total();`)
    await expect(run(c => confirmGrades(c,week,[{student_id:student,exam_question_id:question,is_correct:false}]))).rejects.toThrow()
    expect((await db.query('select is_correct from student_answer')).rows).toEqual([{is_correct:true}])
    await db.exec('drop trigger fail_total on week_score')
    await run(c => confirmGrades(c,week,[{student_id:student,exam_question_id:question,is_correct:true}]))
    expect((await db.query('select reading_correct::int from week_score')).rows).toEqual([{reading_correct:1}])
  })

  it('rejects foreign student/class links even under dev allow-all policies', async () => {
    await expect(run(c => enrollStudent(c,cls,{student_id:foreignStudent}))).rejects.toMatchObject({status:403})
    await expect(run(c => registerStudent(c,{name:'invalid',class_id:otherClass}))).rejects.toMatchObject({status:403})
    await expect(run(c => executeStatements(c.tx,insertRows('week_score',[{week_id:otherWeek,student_id:student}])))).rejects.toThrow()
    await expect(run(c => executeStatements(c.tx,insertRows('class_student',[{class_id:cls,student_id:foreignStudent}])))).rejects.toThrow()
    await expect(run(c => c.tx.execute(sql`truncate public.student cascade`))).rejects.toThrow()
  })

  it('rolls back student creation when class enrollment fails', async () => {
    await db.exec(`create function fail_enroll() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$;
      create trigger fail_enroll before insert on class_student for each row execute function fail_enroll();`)
    await expect(run(c => registerStudent(c,{name:'rollback',class_id:cls}))).rejects.toThrow()
    expect((await db.query("select id from student where name='rollback'")).rows).toEqual([])
    await db.exec('drop trigger fail_enroll on class_student')
    const added = await run(c => registerStudent(c,{name:'created',class_id:cls}))
    expect((await db.query('select student_id from class_student where student_id=$1',[added.id])).rows).toEqual([{student_id:added.id}])
  })

  it('rolls back withdrawal when closing clinic enrollment fails', async () => {
    await db.exec(`insert into clinic_enrollment(teacher_id,student_id,clinic_slot_id,start_date) values('${teacher}','${student}','00000000-0000-4000-8000-000000000099','2026-01-01');
      create function fail_clinic() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$;
      create trigger fail_clinic before update on clinic_enrollment for each row execute function fail_clinic();`)
    await expect(run(c => changeEnrollment(c,student,cls,'withdraw',{left_at:'2026-10-19'}))).rejects.toThrow()
    expect((await db.query('select left_at from class_student where student_id=$1',[student])).rows).toEqual([{left_at:null}])
    await db.exec('drop trigger fail_clinic on clinic_enrollment')
    await run(c => changeEnrollment(c,student,cls,'withdraw',{left_at:'2026-10-19'}))
    expect((await db.query('select end_date::text from clinic_enrollment')).rows).toEqual([{end_date:'2026-10-19'}])
  })

  it('rolls back mock totals and result creation if answer insert fails', async () => {
    await db.exec(`create function fail_mock() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$;
      create trigger fail_mock before insert on mock_exam_student_answer for each row execute function fail_mock();`)
    await expect(run(c => saveMockResult(c,exam,{student_id:student,answers:[{question_number:1,student_answer:2}]}))).rejects.toThrow()
    expect((await db.query('select * from mock_exam_result')).rows).toEqual([])
    await db.exec('drop trigger fail_mock on mock_exam_student_answer')
    const result = await run(c => saveMockResult(c,exam,{student_id:student,answers:[{question_number:1,student_answer:2}]}))
    expect(result.raw_score).toBe(2)
    expect((await db.query('select is_correct from mock_exam_student_answer')).rows).toEqual([{is_correct:true}])
  })

  it('rejects OCR results if an answer key or existing result changed during OCR', async () => {
    const expected = await run(c => captureMockInputs(c,exam))
    await db.exec(`update mock_exam_question set correct_answer='3'`)
    await expect(run(c => saveMockResult(c,exam,{student_id:student,answers:[]},{version:expected.version,result:expected.results[student]}))).rejects.toMatchObject({status:409})
    const next = await run(c => captureMockInputs(c,exam))
    await db.exec(`update mock_exam_result set teacher_comment='new'`)
    await expect(run(c => saveMockResult(c,exam,{student_id:student,answers:[]},{version:next.version,result:next.results[student]}))).rejects.toMatchObject({status:409})
  })

  it('supports JSON/array payloads and excludes void answers from reading totals', async () => {
    await run(c => executeStatements(c.tx,insertRows('vocab_word_variant',[{vocab_word_id:word,word:'variant',excluded_meanings:['a','b']}])) )
    expect((await db.query('select excluded_meanings from vocab_word_variant')).rows).toEqual([{excluded_meanings:['a','b']}])
    await db.exec('update exam_question set is_void=true')
    await run(c => executeStatements(c.tx,readingTotals([score])))
    expect((await db.query('select reading_correct from week_score where id=$1',[score])).rows).toEqual([{reading_correct:null}])
  })

  it('does not conflict with a different student being graded in parallel', async () => {
    const other = await run(c=>registerStudent(c,{name:'parallel',class_id:cls}))
    const version=await run(c=>weekVersion(c,week,[student]))
    await run(c=>executeStatements(c.tx,insertRows('week_score',[{week_id:week,student_id:other.id,vocab_correct:2}],['week_id','student_id'])))
    await run(c=>executeStatements(c.tx,[updateRows('week',{reading_total:1},sql`id=${week}::uuid`)]))
    await run(c=>applyWeekPlan(c,week,version,[updateRows('week_score',{vocab_correct:1},sql`id=${score}::uuid`,true)],[student]))
    expect((await db.query('select vocab_correct from week_score where id=$1',[score])).rows[0]).toEqual({vocab_correct:1})
  })

  it('rolls back a question key and answer regrades if a later tag is foreign',async()=>{
    await db.exec(`insert into concept_tag(teacher_id,name) values('00000000-0000-4000-8000-000000000002','foreign')`)
    const foreign=(await db.query<{id:string}>('select id from concept_tag')).rows[0].id
    const before=(await db.query('select correct_answer from exam_question where id=$1',[question])).rows
    await expect(run(c=>editQuestions(c,week,[{id:question,question_style:'objective',correct_answer:3,concept_tag_ids:[foreign]}]))).rejects.toMatchObject({status:403})
    expect((await db.query('select correct_answer from exam_question where id=$1',[question])).rows).toEqual(before)
    await run(c=>editQuestions(c,week,[{id:question,question_style:'objective',correct_answer:3,is_void:true,concept_tag_ids:[]}]))
    expect((await db.query('select reading_correct from week_score where id=$1',[score])).rows).toEqual([{reading_correct:null}])
  })

  it('rolls back mock question edits if regrading a later answer fails',async()=>{
    const before=(await db.query('select correct_answer from mock_exam_question where id=$1',[mockQuestion])).rows
    await db.exec(`create trigger fail_mock before update on mock_exam_student_answer for each row execute function fail_mock()`)
    await expect(run(c=>replaceMockQuestions(c,exam,[{mock_exam_id:exam,question_number:1,correct_answer:'4'}]))).rejects.toThrow()
    expect((await db.query('select correct_answer from mock_exam_question where id=$1',[mockQuestion])).rows).toEqual(before)
    await db.exec('drop trigger fail_mock on mock_exam_student_answer')
    await run(c=>replaceMockQuestions(c,exam,[{mock_exam_id:exam,question_number:1,correct_answer:'4'}]))
    expect((await db.query('select raw_score from mock_exam_result where mock_exam_id=$1',[exam])).rows).toEqual([{raw_score:0}])
  })

  it('regrades confirmed objective answers when the objective key changes',async()=>{
    await db.exec(`update exam_question set is_void=false,question_style='objective',correct_answer=2 where id='${question}';
      update student_answer set student_answer=2,is_correct=true,teacher_confirmed=true where exam_question_id='${question}'`)
    await run(c=>editQuestions(c,week,[{id:question,correct_answer:3,concept_tag_ids:[]}]))
    expect((await db.query('select is_correct from student_answer where exam_question_id=$1',[question])).rows).toEqual([{is_correct:false}])
    expect((await db.query('select reading_correct::int from week_score where id=$1',[score])).rows).toEqual([{reading_correct:0}])
  })

  it('rolls back mock exam creation if default questions cannot be inserted',async()=>{
    await db.exec(`create trigger fail_mock before insert on mock_exam_question for each row execute function fail_mock()`)
    await expect(run(c=>createMockExam(c,{title:'rollback exam',exam_year:2026,exam_month:10,class_id:null}))).rejects.toThrow()
    expect((await db.query("select id from mock_exam where title='rollback exam'")).rows).toEqual([])
    await db.exec('drop trigger fail_mock on mock_exam_question')
  })

  it('rolls back report publication and preserves public snapshot privacy',async()=>{
    const result=(await db.query<{id:string}>('select id from mock_exam_result where mock_exam_id=$1',[exam])).rows[0]
    await db.exec(`create trigger fail_mock before update on mock_exam_result for each row execute function fail_mock()`)
    await expect(run(c=>publishMockReports(c,exam,[result.id]))).rejects.toThrow()
    expect((await db.query('select id from mock_exam_report')).rows).toEqual([])
    await db.exec('drop trigger fail_mock on mock_exam_result')
    const reports=await run(c=>publishMockReports(c,exam,[result.id]))
    const snapshot=reports[0].snapshot_json as {student:Record<string,unknown>}
    expect(Object.keys(snapshot.student).sort()).toEqual(['grade','id','name','school'])
    const again=await run(c=>publishMockReports(c,exam,[result.id]))
    expect(again[0].share_token).toBe(reports[0].share_token)
  })

  it('also works with actual production policy expressions, including clinic_slot dependencies',async()=>{
    const tables=['student','class_student','clinic_enrollment','clinic_slot','exam_question','vocab_word','vocab_word_variant','week_score','student_answer','student_vocab_answer','vocab_test','vocab_test_item','mock_exam','mock_exam_question','mock_exam_result','mock_exam_student_answer','mock_exam_report','concept_tag','exam_question_tag']
    for(const table of tables) await db.exec(`drop policy dev_allow on ${table}`)
    await db.exec(`create function my_teacher_id() returns uuid language sql stable security definer set search_path=public as $$select id from teacher where auth_id=auth.uid()$$;
      create function is_vocab_week_owner(p_week_id uuid) returns boolean language sql stable security definer set search_path=public as $$
      select exists(select 1 from week w join class c on c.id=w.class_id join teacher t on t.id=c.teacher_id where w.id=p_week_id and t.auth_id=auth.uid())$$;`)
    await db.exec(readFileSync('tests/fixtures/production-compound-policies.sql','utf8'))
    const added=await run(c=>registerStudent(c,{name:'production policies',class_id:cls}))
    await run(c=>changeEnrollment(c,String(added.id),cls,'withdraw',{left_at:'2026-10-19'}))
    await run(c=>editQuestions(c,week,[{id:question,is_void:false,concept_tag_ids:[]}]))
    const result=await run(c=>saveMockResult(c,exam,{student_id:student,answers:[]}))
    await run(c=>publishMockReports(c,exam,[String(result.id)]))
    await expect(run(c=>enrollStudent(c,cls,{student_id:foreignStudent}))).rejects.toMatchObject({status:403})
  })
})
