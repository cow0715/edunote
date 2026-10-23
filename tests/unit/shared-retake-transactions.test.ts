import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { sql } from 'drizzle-orm'
import { applyRetake, snapshotRetake } from '@/lib/services/shared-retake'
import type { TeacherTransaction } from '@/lib/db/transaction'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: vi.fn() }))
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const student = id(41), week = id(31), token = id(91), previous = id(92), first = id(81), second = id(82)
describe('shared retake atomic PostgreSQL persistence under the app role', () => {
 let db: PGlite
 let orm: ReturnType<typeof drizzle>
 beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync('tests/fixtures/transaction-schema.sql', 'utf8'))
  await db.exec(readFileSync('tests/fixtures/compound-transaction-schema.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20260929101449_server_transaction_role.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261019000002_expand_transaction_writes.sql', 'utf8'))

  await db.exec(`create function my_teacher_id() returns uuid language sql stable security definer set search_path=public as $$select id from teacher where auth_id=auth.uid()$$;
   create function is_vocab_week_owner(p_week_id uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from week w join class c on c.id=w.class_id join teacher t on t.id=c.teacher_id where w.id=p_week_id and t.auth_id=auth.uid())$$;`)
  await db.exec(readFileSync('tests/fixtures/production-compound-policies.sql', 'utf8'))
  await db.exec(`insert into week(id,class_id,week_number) values('${week}','${id(21)}',1),('${id(32)}','${id(22)}',1);
   insert into student(id,teacher_id,name,share_token) values('${student}','${id(1)}','synthetic','${token}'),('${id(42)}','${id(2)}','foreign','${id(93)}');
   insert into class_student(class_id,student_id) values('${id(21)}','${student}');
   insert into week_score(id,week_id,student_id,vocab_retake_correct) values('${id(71)}','${week}','${student}',0),('${id(72)}','${id(32)}','${id(42)}',0);
   insert into vocab_word(id,week_id,number,english_word,correct_answer) values('${id(51)}','${week}',1,'apple','사과'),('${id(52)}','${week}',2,'book','책'),('${id(53)}','${id(32)}',1,'foreign','foreign');
   insert into student_vocab_answer(id,week_score_id,vocab_word_id,is_correct) values('${first}','${id(71)}','${id(51)}',false),('${second}','${id(71)}','${id(52)}',false),('${id(83)}','${id(72)}','${id(53)}',false);`)
  orm = drizzle(db)
 }, 30000)
 afterAll(async () => { await db?.close() })
 beforeEach(async () => {
  await db.exec(`drop trigger if exists reject_answer on student_vocab_answer; drop trigger if exists reject_score on week_score;
   update student set share_token='${token}',previous_share_token='${previous}',previous_share_token_expires_at=now()+interval '1 day' where id='${student}';
   update class set archived_at=null where id='${id(21)}'; update class_student set left_at=null;
   update vocab_word set correct_answer='사과' where id='${id(51)}';
   update student_vocab_answer set is_correct=false,retake_answer=null,retake_is_correct=null;
   update week_score set vocab_retake_correct=0;`)
 })
 const run = <T>(work: (context: TeacherTransaction) => Promise<T>) => orm.transaction(async tx => {
  await tx.execute(sql`set local role edunote_app`)
  await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: id(11) })}, true)`)
  return work({ tx: tx as unknown as TeacherTransaction['tx'], teacherId: id(1) })
 })
 const capture = (ids = [first, second], share = token) => run(c => snapshotRetake(c, share, week, student, ids))
 const result = (answer_id: string) => ({ answer_id, retake_answer: 'synthetic', is_correct: true })
 const state = async () => ({ answers: (await db.query('select retake_answer,retake_is_correct from student_vocab_answer where week_score_id=$1 order by id', [id(71)])).rows,
  score: (await db.query('select vocab_retake_correct from week_score where id=$1', [id(71)])).rows[0] })
 it('commits answer rows and totals together', async () => {
  const snapshot = await capture()
  expect(await run(c => applyRetake(c, token, week, snapshot, [result(first), result(second)]))).toEqual({ total_mastered: 2, remaining: 0 })
  expect((await state()).score).toEqual({ vocab_retake_correct: 2 })
 })
 it('rolls back an earlier answer when a later answer fails', async () => {
  const snapshot = await capture(), before = await state()
  await db.exec(`create or replace function fail_second() returns trigger language plpgsql as $$begin if new.id='${second}' then raise exception 'injected'; end if; return new; end$$;
   create trigger reject_answer before update on student_vocab_answer for each row execute function fail_second();`)
  await expect(run(c => applyRetake(c, token, week, snapshot, [result(first), result(second)]))).rejects.toThrow()
  expect(await state()).toEqual(before)
 })
 it('rolls back all answers when aggregate saving fails', async () => {
  const snapshot = await capture(), before = await state()
  await db.exec(`create or replace function fail_score() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$;
   create trigger reject_score before update on week_score for each row execute function fail_score();`)
  await expect(run(c => applyRetake(c, token, week, snapshot, [result(first), result(second)]))).rejects.toThrow()
  expect(await state()).toEqual(before)
 })
 it('recomputes cumulative totals when two submissions were captured before either save', async () => {
  const a = await capture([first]), b = await capture([second])
  expect(await run(c => applyRetake(c, token, week, a, [result(first)]))).toEqual({ total_mastered: 1, remaining: 1 })
  expect(await run(c => applyRetake(c, token, week, b, [result(second)]))).toEqual({ total_mastered: 2, remaining: 0 })
 })
 it('rejects grading inputs changed during AI without overwriting answers', async () => {
  const snapshot = await capture(), before = await state()
  await db.exec(`update vocab_word set correct_answer='changed' where id='${id(51)}'`)
  await expect(run(c => applyRetake(c, token, week, snapshot, [result(first), result(second)]))).rejects.toMatchObject({ status: 409 })
  expect(await state()).toEqual(before)
 })
 it('supports a graced token and rejects it if it expires during grading', async () => {
  const snapshot = await capture([first], previous)
  await db.exec(`update student set previous_share_token_expires_at=now()-interval '1 second' where id='${student}'`)
  await expect(run(c => applyRetake(c, previous, week, snapshot, [result(first)]))).rejects.toMatchObject({ status: 410 })
  expect((await state()).score).toEqual({ vocab_retake_correct: 0 })
 })
 it('rechecks enrollment and archived class status before saving', async () => {
  const snapshot = await capture()
  await db.exec(`update class_student set left_at=now() where student_id='${student}'`)
  await expect(run(c => applyRetake(c, token, week, snapshot, [result(first), result(second)]))).rejects.toMatchObject({ status: 403 })
  await db.exec(`update class_student set left_at=null; update class set archived_at=now() where id='${id(21)}'`)
  await expect(run(c => applyRetake(c, token, week, snapshot, [result(first), result(second)]))).rejects.toMatchObject({ status: 403 })
 })
 it('rejects foreign, duplicate, originally correct answers and invalid capabilities', async () => {
  await expect(capture([id(83)])).rejects.toMatchObject({ status: 400 })
  await expect(capture([first, first])).rejects.toMatchObject({ status: 400 })
  await expect(capture([first], 'invalid-token')).rejects.toMatchObject({ status: 404 })
  await expect(run(c => snapshotRetake(c, id(93), id(32), id(42), [id(83)]))).rejects.toMatchObject({ status: 403 })
  await db.exec(`update student_vocab_answer set is_correct=true where id='${first}'`)
  await expect(capture([first])).rejects.toMatchObject({ status: 400 })
 })
})
