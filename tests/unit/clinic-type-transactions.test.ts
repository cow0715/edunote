import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { sql } from 'drizzle-orm'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { resetConceptDefaults, DEFAULT_CATEGORIES } from '@/lib/services/concept-defaults'
import { saveClinicEnrollment } from '@/lib/services/clinic-enrollments'
vi.mock('server-only',()=>({}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const teacher=id(1), user=id(11), cls=id(21), student=id(41), slot=id(51), secondSlot=id(52)
const migration='supabase/migrations/20261023124035_clinic_type_transactions.sql'
describe('concept defaults and clinic enrollment transactions under RLS',()=>{
  let db:PGlite
  let orm:ReturnType<typeof drizzle>
  beforeAll(async()=>{
    db=new PGlite()
    for(const file of ['tests/fixtures/transaction-schema.sql','tests/fixtures/compound-transaction-schema.sql',
      'supabase/migrations/20260929101449_server_transaction_role.sql','supabase/migrations/20261019000002_expand_transaction_writes.sql'])
      await db.exec(readFileSync(file,'utf8'))
    await db.exec(`create table concept_category(id uuid primary key default gen_random_uuid(),teacher_id uuid references teacher,name text not null,sort_order int default 0);
      alter table concept_tag add column concept_category_id uuid references concept_category on delete set null,add column sort_order int default 0;
      alter table clinic_slot add column is_active boolean default true;
      create table tag_reference(id int primary key,concept_tag_id uuid references concept_tag on delete cascade);
      insert into student(id,teacher_id,name) values('${student}','${teacher}','own'),('${id(42)}','${id(2)}','foreign');
      insert into class_student(class_id,student_id) values('${cls}','${student}');
      insert into clinic_slot(id,teacher_id,is_active) values('${slot}','${teacher}',true),('${secondSlot}','${teacher}',true),('${id(53)}','${teacher}',false),('${id(54)}','${id(2)}',true);
      insert into concept_category(id,teacher_id,name) values('${id(61)}','${teacher}','old'),('${id(62)}','${id(2)}','foreign');
      insert into concept_tag(id,teacher_id,concept_category_id,name) values('${id(71)}','${teacher}','${id(61)}','old'),('${id(72)}','${id(2)}','${id(62)}','foreign');
      insert into tag_reference values(1,'${id(71)}');`)
    await db.exec(readFileSync(migration,'utf8'))
    orm=drizzle(db)
  },30_000)
  afterAll(async()=>{await db?.close()})
  const run=<T>(work:(c:TeacherTransaction)=>Promise<T>)=>orm.transaction(async tx=>{
    await tx.execute(sql`set local role edunote_app`)
    await tx.execute(sql`select set_config('request.jwt.claims',${JSON.stringify({sub:user})},true)`)
    return work({tx:tx as unknown as TeacherTransaction['tx'],teacherId:teacher})
  })
  it('rolls back deleted categories, tags and FK cascades on a later replacement failure',async()=>{
    await db.exec(`create function fail_tag() returns trigger language plpgsql as $$begin if new.name='가정법/조동사' then raise exception 'injected'; end if;return new;end$$;
      create trigger fail_tag before insert on concept_tag for each row execute function fail_tag();`)
    await expect(run(resetConceptDefaults)).rejects.toThrow()
    expect((await db.query('select name from concept_category order by name')).rows).toEqual([{name:'foreign'},{name:'old'}])
    expect((await db.query('select name from concept_tag order by name')).rows).toEqual([{name:'foreign'},{name:'old'}])
    expect((await db.query('select * from tag_reference')).rows).toEqual([{id:1,concept_tag_id:id(71)}])
    await db.exec('drop trigger fail_tag on concept_tag')
  })
  it('replaces only own defaults with the unchanged category/tag order and can repeat',async()=>{
    await run(resetConceptDefaults)
    const rows=()=>db.query<{name:string;sort_order:number;tags:string[]}>(`select c.name,c.sort_order,json_agg(t.name order by t.sort_order) as tags from concept_category c join concept_tag t on t.concept_category_id=c.id where c.teacher_id='${teacher}' group by c.id order by c.sort_order`)
    expect((await rows()).rows.map(r=>({name:r.name,tags:r.tags}))).toEqual(DEFAULT_CATEGORIES)
    await run(resetConceptDefaults)
    expect((await rows()).rows).toHaveLength(3)
    expect((await db.query(`select name from concept_tag where teacher_id='${id(2)}'`)).rows).toEqual([{name:'foreign'}])
  })
  it('restricts category/tag writes and clinic inserts to owned records despite broad policies',async()=>{
    await expect(run(c=>c.tx.execute(sql`insert into concept_category(teacher_id,name) values(${id(2)}::uuid,'forged')`))).rejects.toThrow()
    await expect(run(c=>c.tx.execute(sql`insert into concept_tag(teacher_id,name) values(${id(2)}::uuid,'forged')`))).rejects.toThrow()
    for(const [t,s,k] of [[id(2),student,slot],[teacher,id(42),slot],[teacher,student,id(54)]])
      await expect(run(c=>c.tx.execute(sql`insert into clinic_enrollment(teacher_id,student_id,clinic_slot_id) values(${t}::uuid,${s}::uuid,${k}::uuid)`))).rejects.toThrow()
  })
  it('creates an enrollment with its joined slot and repeated requests do not duplicate it',async()=>{
    const first=await run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:slot,start_date:'2026-10-23'}))
    expect(first.enrollment).toMatchObject({student_id:student,clinic_slot_id:slot,end_date:null,clinic_slot:{id:slot}})
    const second=await run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:slot,start_date:'2026-10-24'}))
    expect(second.enrollment?.id).toBe(first.enrollment?.id)
    expect((await db.query('select * from clinic_enrollment')).rows).toHaveLength(1)
  })
  it('moves an open enrollment start earlier and reopens a previously ending overlap',async()=>{
    await run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:slot,start_date:'2026-10-01'}))
    expect((await db.query('select start_date::text from clinic_enrollment')).rows).toEqual([{start_date:'2026-10-01'}])
    await run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:slot,start_date:'2026-10-25',action:'unenroll'}))
    const reopened=await run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:slot,start_date:'2026-10-24'}))
    expect(reopened.enrollment?.end_date).toBeNull()
    expect((await db.query('select * from clinic_enrollment')).rows).toHaveLength(1)
  })
  it('rejects foreign/inactive slots, foreign/non-active students and invalid dates without writes',async()=>{
    const before=(await db.query('select * from clinic_enrollment')).rows
    for(const k of [id(53),id(54)])await expect(run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:k}))).rejects.toMatchObject({status:422})
    await expect(run(c=>saveClinicEnrollment(c,{student_id:id(42),clinic_slot_id:slot}))).rejects.toMatchObject({status:403})
    await expect(run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:slot,start_date:'2026-02-30'}))).rejects.toMatchObject({status:400})
    await db.exec(`update class_student set left_at=now()`)
    await expect(run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:slot}))).rejects.toMatchObject({status:422})
    await db.exec('update class_student set left_at=null')
    expect((await db.query('select * from clinic_enrollment')).rows).toEqual(before)
  })
  it('rolls back every unenrollment if one later update fails, including future starts',async()=>{
    await run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:secondSlot,start_date:'2026-11-10'}))
    await db.exec(`create function fail_close() returns trigger language plpgsql as $$begin if new.clinic_slot_id='${secondSlot}' then raise exception 'injected';end if;return new;end$$;
      create trigger fail_close before update on clinic_enrollment for each row execute function fail_close();`)
    await expect(run(c=>saveClinicEnrollment(c,{student_id:student,start_date:'2026-10-26',action:'unenroll'}))).rejects.toThrow()
    expect((await db.query('select end_date from clinic_enrollment')).rows).toEqual([{end_date:null},{end_date:null}])
    await db.exec('drop trigger fail_close on clinic_enrollment')
    await run(c=>saveClinicEnrollment(c,{student_id:student,start_date:'2026-10-26',action:'unenroll'}))
    expect((await db.query('select end_date::text from clinic_enrollment order by start_date')).rows).toEqual([{end_date:'2026-10-26'},{end_date:'2026-11-10'}])
  })
  it('does not create a partial enrollment when insert fails and migration is repeatable',async()=>{
    await db.exec(`create function fail_enroll() returns trigger language plpgsql as $$begin raise exception 'injected';end$$;
      create trigger fail_enroll before insert on clinic_enrollment for each row execute function fail_enroll();`)
    await expect(run(c=>saveClinicEnrollment(c,{student_id:student,clinic_slot_id:slot,start_date:'2026-12-01'}))).rejects.toThrow()
    expect((await db.query('select * from clinic_enrollment')).rows).toHaveLength(2)
    await db.exec('drop trigger fail_enroll on clinic_enrollment')
    await db.exec(readFileSync(migration,'utf8'))
  })
})
