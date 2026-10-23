import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { sql } from 'drizzle-orm'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { publishMonthlyBatch, publishMockBatch } from '@/lib/services/report-dispatch'
vi.mock('server-only', () => ({}))
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const teacher=id(1), user=id(11), cls=id(21), student=id(41), second=id(43), exam=id(81)
const pair={student_id:student,class_id:cls}
const migration='supabase/migrations/20261023120006_report_dispatch_transactions.sql'
describe('report dispatch batches under the restricted PostgreSQL role', () => {
  let db: PGlite
  let orm: ReturnType<typeof drizzle>
  beforeAll(async () => {
    db=new PGlite()
    for(const file of ['tests/fixtures/transaction-schema.sql','tests/fixtures/compound-transaction-schema.sql',
      'supabase/migrations/20260929101449_server_transaction_role.sql','supabase/migrations/20261019000002_expand_transaction_writes.sql',
      'supabase/migrations/20260415000001_add_report_card.sql']) await db.exec(readFileSync(file,'utf8'))
    await db.exec(`alter table report_card add column class_id uuid references class on delete cascade,
      add column share_token text default gen_random_uuid()::text unique, add column revoked_at timestamptz;
      insert into student(id,teacher_id,name) values('${student}','${teacher}','first'),('${second}','${teacher}','second'),('${id(42)}','${id(2)}','foreign');
      insert into mock_exam(id,teacher_id,title,exam_year,exam_month) values('${exam}','${teacher}','test',2026,10);
      insert into mock_exam_result(id,mock_exam_id,student_id) values('${id(91)}','${exam}','${student}'),('${id(92)}','${exam}','${second}');`)
    await db.exec(readFileSync(migration,'utf8'))
    orm=drizzle(db)
  },30_000)
  afterAll(async()=>{await db?.close()})
  const run=<T>(work:(c:TeacherTransaction)=>Promise<T>)=>orm.transaction(async tx=>{
    await tx.execute(sql`set local role edunote_app`)
    await tx.execute(sql`select set_config('request.jwt.claims',${JSON.stringify({sub:user})},true)`)
    return work({tx:tx as unknown as TeacherTransaction['tx'],teacherId:teacher})
  })
  it('creates and publishes missing monthly cards together, deduplicates and keeps the link on retry',async()=>{
    const first=await run(c=>publishMonthlyBatch(c,2026,10,[pair,pair]))
    expect(first.created_count).toBe(1)
    expect(first.cards).toHaveLength(1)
    expect(first.cards[0].status).toBe('published')
    const again=await run(c=>publishMonthlyBatch(c,2026,10,[pair]))
    expect(again.created_count).toBe(0)
    expect(again.cards[0].share_token).toBe(first.cards[0].share_token)
  })
  it('rolls back both newly created cards and existing draft publication on a later failure',async()=>{
    await db.exec(`insert into report_card(teacher_id,student_id,class_id,period_type,period_start,period_end,period_label,teacher_comment)
      values('${teacher}','${student}','${cls}','monthly','2026-11-01','2026-11-30','November','keep');
      create function fail_report() returns trigger language plpgsql as $$begin
        if new.student_id='${second}' then raise exception 'injected'; end if; return new; end$$;
      create trigger fail_report before update on report_card for each row execute function fail_report();`)
    await expect(run(c=>publishMonthlyBatch(c,2026,11,[pair,{student_id:second,class_id:cls}]))).rejects.toThrow()
    expect((await db.query("select status,teacher_comment from report_card where period_start='2026-11-01'")).rows).toEqual([{status:'draft',teacher_comment:'keep'}])
    await db.exec('drop trigger fail_report on report_card')
  })
  it('rejects foreign students/classes and invalid periods before writing',async()=>{
    await expect(run(c=>publishMonthlyBatch(c,2026,12,[pair,{student_id:id(42),class_id:cls}]))).rejects.toMatchObject({status:403})
    await expect(run(c=>publishMonthlyBatch(c,2026,12,[{student_id:student,class_id:id(22)}]))).rejects.toMatchObject({status:403})
    await expect(run(c=>publishMonthlyBatch(c,2026,13,[pair]))).rejects.toMatchObject({status:400})
    expect((await db.query("select * from report_card where period_start='2026-12-01'")).rows).toHaveLength(0)
  })
  it('RLS refuses a forged teacher, foreign student, and foreign class even in direct SQL',async()=>{
    for(const [t,s,c] of [[id(2),student,cls],[teacher,id(42),cls],[teacher,student,id(22)]]) {
      await expect(run(async context=>context.tx.execute(sql`insert into report_card(teacher_id,student_id,class_id,period_type,period_start,period_end,period_label)
        values(${t}::uuid,${s}::uuid,${c}::uuid,'monthly','2026-12-01','2026-12-31','test')`))).rejects.toThrow()
    }
    await expect(run(async c=>c.tx.execute(sql`update report_card set student_id=${id(42)}::uuid`))).rejects.toThrow()
  })
  it('publishes every mock report/result atomically and preserves snapshots on redispatch',async()=>{
    const first=await run(c=>publishMockBatch(c,exam,[id(91),id(92),id(91)]))
    expect(first.created_count).toBe(2)
    expect(first.reports).toHaveLength(2)
    expect((await db.query('select status from mock_exam_result')).rows).toEqual([{status:'published'},{status:'published'}])
    const before=(await db.query('select * from mock_exam_report order by id')).rows
    expect((await run(c=>publishMockBatch(c,exam,[id(91),id(92)]))).created_count).toBe(0)
    expect((await db.query('select * from mock_exam_report order by id')).rows).toEqual(before)
  })
  it('rolls back earlier mock report/result updates if a later result fails',async()=>{
    await db.exec(`delete from mock_exam_report; update mock_exam_result set status='draft',published_at=null;
      create function fail_mock_report() returns trigger language plpgsql as $$begin
        if new.mock_exam_result_id='${id(92)}' then raise exception 'injected'; end if; return new; end$$;
      create trigger fail_mock_report before insert on mock_exam_report for each row execute function fail_mock_report();`)
    await expect(run(c=>publishMockBatch(c,exam,[id(91),id(92)]))).rejects.toThrow()
    expect((await db.query('select * from mock_exam_report')).rows).toHaveLength(0)
    expect((await db.query('select status,published_at from mock_exam_result')).rows).toEqual([{status:'draft',published_at:null},{status:'draft',published_at:null}])
    await db.exec('drop trigger fail_mock_report on mock_exam_report')
    await expect(run(c=>publishMockBatch(c,exam,[id(91),id(99)]))).rejects.toMatchObject({status:404})
    expect((await db.query('select * from mock_exam_report')).rows).toHaveLength(0)
  })
  it('migration is repeatable and grants no report deletion privilege',async()=>{
    await db.exec(readFileSync(migration,'utf8'))
    expect((await db.query("select has_table_privilege('edunote_app','report_card','DELETE') as allowed")).rows).toEqual([{allowed:false}])
  })
})
