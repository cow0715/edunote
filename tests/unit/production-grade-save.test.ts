import {beforeAll,afterAll,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {drizzle} from 'drizzle-orm/pglite'
import {sql} from 'drizzle-orm'
import {applyGradePlan,activeVocabTotals,requireGradeToken} from '@/lib/services/grade-save'
import {weekVersion} from '@/lib/services/week-save'
import {insertRows,updateRows} from '@/lib/db/statements'
import type {TeacherTransaction} from '@/lib/db/transaction'
vi.mock('server-only',()=>({}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const teacher=id(1),cls=id(21),week=id(31),student=id(41),score=id(51),question=id(61)
let db:PGlite,orm:ReturnType<typeof drizzle>
beforeAll(async()=>{
 db=new PGlite();await db.exec(readFileSync('tests/fixtures/transaction-schema.sql','utf8'));await db.exec(readFileSync('tests/fixtures/compound-transaction-schema.sql','utf8'))
 await db.exec(`insert into week(id,class_id,week_number) values('${week}','${cls}',1);
 insert into student(id,teacher_id,name) values('${student}','${teacher}','synthetic');
 insert into class_student(class_id,student_id) values('${cls}','${student}');
 insert into week_score(id,week_id,student_id,memo,exam_photo_path) values('${score}','${week}','${student}','before','old-photo');
 insert into exam_question(id,week_id,question_number,exam_type) values('${question}','${week}',1,'reading');`)
 orm=drizzle(db)
},30000)
afterAll(async()=>{await db?.close()})
const run=<T>(f:(c:TeacherTransaction)=>Promise<T>)=>orm.transaction(tx=>f({tx:tx as unknown as TeacherTransaction['tx'],teacherId:teacher}))
it('rejects missing, numeric, forged client versions; accepts production snapshot hash',()=>{
 for(const value of [null,{}, {score_id:null,revision:null},{score_id:'old',revision:1},{score_id:null,revision:'abc'}])expect(()=>requireGradeToken(value)).toThrow()
 expect(requireGradeToken({score_id:null,revision:'a'.repeat(64)})).toBe('a'.repeat(64))
})
it('commits answers/photo linkage together and acknowledges the hash inside the same transaction',async()=>{
 const token=await run(c=>weekVersion(c,week,[student]))
 const result=await run(c=>applyGradePlan(c,week,token,[updateRows('week_score',{memo:'saved',exam_photo_path:'new-photo'},sql`id=${score}::uuid`,true),...insertRows('student_answer',[{week_score_id:score,exam_question_id:question,student_answer:3,is_correct:true}],['week_score_id','exam_question_id'])],[student]))
 expect(result.versions[0].revision).toBe(await run(c=>weekVersion(c,week,[student])))
 expect(result.versions[0].revision).not.toBe(token)
 expect((await db.query('select memo,exam_photo_path from week_score')).rows[0]).toMatchObject({memo:'saved',exam_photo_path:'new-photo'})
})
it('rejects stale edits and preserves the newer answers/photo',async()=>{
 const token=await run(c=>weekVersion(c,week,[student]))
 await db.exec(`update student_answer set student_answer=4 where week_score_id='${score}'`)
 await expect(run(c=>applyGradePlan(c,week,token,[updateRows('week_score',{exam_photo_path:'stale-photo'},sql`id=${score}::uuid`,true)],[student]))).rejects.toThrow('답안이 변경')
 expect((await db.query('select exam_photo_path from week_score')).rows[0]).toMatchObject({exam_photo_path:'new-photo'})
})
it('rolls back an earlier photo/memo update when a later answer fails',async()=>{
 const token=await run(c=>weekVersion(c,week,[student]))
 await expect(run(c=>applyGradePlan(c,week,token,[updateRows('week_score',{memo:'partial',exam_photo_path:'bad-photo'},sql`id=${score}::uuid`,true),...insertRows('student_answer',[{week_score_id:score,exam_question_id:id(999)}])],[student]))).rejects.toThrow()
 expect((await db.query('select memo,exam_photo_path from week_score')).rows[0]).toMatchObject({memo:'saved',exam_photo_path:'new-photo'})
})
it('only counts the active vocabulary test; residual historical answers stay intact',async()=>{
 await db.exec(`insert into vocab_word(id,week_id,number,english_word) values('${id(71)}','${week}',1,'active'),('${id(72)}','${week}',2,'old');
 insert into vocab_test(id,week_id) values('${id(81)}','${week}');
 insert into vocab_test_item(vocab_test_id,vocab_word_id,test_number,sort_order) values('${id(81)}','${id(71)}',1,1);
 insert into student_vocab_answer(week_score_id,vocab_word_id,is_correct,teacher_locked) values('${score}','${id(71)}',true,true),('${score}','${id(72)}',true,false);`)
 const token=await run(c=>weekVersion(c,week,[student]))
 await run(c=>applyGradePlan(c,week,token,activeVocabTotals([score]),[student]))
 expect((await db.query('select vocab_correct from week_score')).rows[0]).toMatchObject({vocab_correct:1})
 expect((await db.query('select count(*)::int as n from student_vocab_answer')).rows[0]).toMatchObject({n:2})
})

it('allows different students in one batch to finish without falsely conflicting',async()=>{
 const second=id(42),secondScore=id(52)
 await db.exec(`insert into student(id,teacher_id,name) values('${second}','${teacher}','second synthetic');
 insert into class_student(class_id,student_id) values('${cls}','${second}');
 insert into week_score(id,week_id,student_id) values('${secondScore}','${week}','${second}');`)
 const firstToken=await run(c=>weekVersion(c,week,[student]))
 const secondToken=await run(c=>weekVersion(c,week,[second]))
 await run(c=>applyGradePlan(c,week,firstToken,[updateRows('week_score',{memo:'first complete'},sql`id=${score}::uuid`,true)],[student]))
 await run(c=>applyGradePlan(c,week,secondToken,[updateRows('week_score',{memo:'second complete'},sql`id=${secondScore}::uuid`,true)],[second]))
 expect((await db.query('select memo from week_score order by id')).rows).toEqual([{memo:'first complete'},{memo:'second complete'}])
})
