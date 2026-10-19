import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { sql } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { managePeriod } from '@/lib/services/class-periods'
import { changeClassWeeks, sessionDates, updateWeek } from '@/lib/services/class-weeks'
import { createClass } from '@/lib/services/classes'

vi.mock('server-only', () => ({}))
const classId = '00000000-0000-4000-8000-000000000021'
const otherClass = '00000000-0000-4000-8000-000000000022'
const teacherId = '00000000-0000-4000-8000-000000000001'
const userId = '00000000-0000-4000-8000-000000000011'

describe('transaction services against isolated PostgreSQL (PGlite)', () => {
  let db: PGlite
  let orm: ReturnType<typeof drizzle<typeof schema>>
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(readFileSync('tests/fixtures/transaction-schema.sql', 'utf8'))
    await db.exec(readFileSync('supabase/migrations/20260929101449_server_transaction_role.sql', 'utf8'))
    orm = drizzle(db, { schema })
  }, 30_000)
  afterAll(async () => { await db?.close() })
  const run = <T>(work: (c: TeacherTransaction) => Promise<T>, uid = userId) => orm.transaction(async tx => {
    await tx.execute(sql`set local role edunote_app`)
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid })}, true)`)
    // The services use the shared PostgreSQL query API; production uses node-postgres.
    return work({ tx: tx as unknown as TeacherTransaction['tx'], teacherId })
  })

  it('keeps dates on default changes and rolls back earlier writes when insertion fails', async () => {
    const old = await run(c => managePeriod(c, classId, 'create', undefined, { label: 'old', semester: 1, start_date: '2026-01-01' }))
    const current = await run(c => managePeriod(c, classId, 'create', undefined, { label: 'current', semester: 2, start_date: '2026-08-01' }))
    if (!('id' in old) || !('id' in current)) throw new Error('fixture')
    const before = (await db.query('select id,start_date::text,end_date::text from class_period order by start_date')).rows
    await run(c => managePeriod(c, classId, 'set_default', old.id))
    expect((await db.query('select id,start_date::text,end_date::text from class_period order by start_date')).rows).toEqual(before)
    await db.exec(`create function fail_period() returns trigger language plpgsql as $$ begin if new.label = 'FAIL' then raise exception 'injected'; end if; return new; end $$;
      create trigger fail_period before insert on class_period for each row execute function fail_period();`)
    await expect(run(c => managePeriod(c, classId, 'create', undefined, { label: 'FAIL', semester: 2, start_date: '2026-09-01' }))).rejects.toThrow()
    expect((await db.query('select id,start_date::text,end_date::text from class_period order by start_date')).rows).toEqual(before)
    expect((await db.query('select id from class_period where is_current')).rows).toEqual([{ id: old.id }])
    await expect(run(c => managePeriod(c, classId, 'delete', old.id))).rejects.toMatchObject({ status: 409 })
    await expect(run(c => managePeriod(c, classId, 'edit', old.id, { is_current: false }))).rejects.toThrow()
    await expect(run(c => managePeriod(c, classId, 'edit', old.id, { start_date: '2026-09-01' }))).rejects.toThrow()
    await run(c => managePeriod(c, classId, 'delete', current.id))
  })

  it('scopes direct SQL despite dev allow-all, clears identity, and denies elevated commands', async () => {
    const own = await run(c => c.tx.select({ id: schema.classes.id }).from(schema.classes))
    expect(own).toEqual([{ id: classId }])
    await expect(run(c => changeClassWeeks(c, otherClass, 'add'))).rejects.toMatchObject({ status: 403 })
    await expect(run(c => c.tx.execute(sql`truncate public.class cascade`))).rejects.toThrow()
    await expect(run(c => c.tx.execute(sql`create table public.forbidden(id int)`))).rejects.toThrow()
    await expect(run(c => c.tx.execute(sql`update public.teacher set approval_status = 'approved'`))).rejects.toThrow()
    await db.exec(`set role edunote_app`)
    expect((await db.query('select id from class')).rows).toEqual([])
    await db.exec('reset role')
    await db.query("update teacher set approval_status = 'blocked' where id = $1", [teacherId])
    await expect(run(c => changeClassWeeks(c, classId, 'add'))).rejects.toMatchObject({ status: 403 })
    await db.query("update teacher set approval_status = 'approved' where id = $1", [teacherId])
  })

  it('rolls back both date and interim numbers on reorder failure, then keeps null dates', async () => {
    const first = await run(c => changeClassWeeks(c, classId, 'add', { start_date: '2026-01-20' }))
    const second = await run(c => changeClassWeeks(c, classId, 'add', { start_date: '2026-01-10' }))
    await run(c => changeClassWeeks(c, classId, 'add'))
    if (!('id' in first) || !('id' in second)) throw new Error('fixture')
    await db.query('update week set week_number = -1 where id = $1', [first.id])
    const before = (await db.query('select id,week_number,start_date::text from week order by id')).rows
    await db.exec(`create function fail_week() returns trigger language plpgsql as $$ begin
      if old.week_number < 0 and new.week_number > 0 then raise exception 'injected'; end if; return new; end $$;
      create trigger fail_week before update on week for each row execute function fail_week();`)
    await expect(run(c => updateWeek(c, first.id, { start_date: '2026-01-01' }))).rejects.toThrow()
    expect((await db.query('select id,week_number,start_date::text from week order by id')).rows).toEqual(before)
    await db.exec('drop trigger fail_week on week')
    await run(c => updateWeek(c, first.id, { start_date: '2026-01-01' }))
    const rows = (await db.query<{ week_number: number; start_date: string | null }>('select week_number,start_date::text from week order by week_number')).rows
    expect(rows.map(row => row.week_number)).toEqual([1, 2, 3])
    expect(rows[2].start_date).toBeNull()
    await run(c => changeClassWeeks(c, classId, 'sync'))
    const synced = (await db.query<{ week_number: number }>('select week_number from week order by week_number')).rows
    expect(synced.map(row => row.week_number)).toEqual(synced.map((_, i) => i + 1))
  })

  it('rolls back inserted weeks if extending the class fails', async () => {
    const before = (await db.query('select * from week order by id')).rows
    await db.exec(`create function fail_class() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$;
      create trigger fail_class before update on class for each row execute function fail_class();`)
    await expect(run(c => changeClassWeeks(c, classId, 'extend', { count: 3 }))).rejects.toThrow()
    expect((await db.query('select * from week order by id')).rows).toEqual(before)
    await db.exec('drop trigger fail_class on class')
    const result = await run(c => changeClassWeeks(c, classId, 'extend', { count: 3 }))
    expect(result).toMatchObject({ added: 3 })
  })

  it('rolls back a newly created class and its weeks when its initial period fails', async () => {
    const before = (await db.query('select id from class order by id')).rows
    await expect(run(c => createClass(c, { name: 'new', start_date: '2026-01-01', end_date: '2026-01-31', schedule_days: ['mon'], period_label: 'FAIL' }))).rejects.toThrow()
    expect((await db.query('select id from class order by id')).rows).toEqual(before)
  })

  it('rolls back when RLS silently filters a later UPDATE to zero rows', async () => {
    const before = (await db.query('select id from week order by id')).rows
    // Simulate approval changing after insertion, before the class UPDATE.
    await db.exec(`create function block_teacher_on_insert() returns trigger language plpgsql security definer set search_path = public as $$
      begin update teacher set approval_status = 'blocked' where id = '${teacherId}'; return new; end $$;
      create trigger block_teacher after insert on week for each row execute function block_teacher_on_insert();`)
    await expect(run(c => changeClassWeeks(c, classId, 'extend', { count: 1 }))).rejects.toMatchObject({ status: 409 })
    expect((await db.query('select id from week order by id')).rows).toEqual(before)
    expect((await db.query('select approval_status from teacher where id = $1', [teacherId])).rows).toEqual([{ approval_status: 'approved' }])
    await db.exec('drop trigger block_teacher on week')
  })

  it('also enforces isolation with the production-style owner policies', async () => {
    await db.exec(`drop policy dev_allow on teacher; drop policy dev_allow on class; drop policy dev_allow on week;
      create function my_teacher_id() returns uuid language sql stable security definer set search_path = public as $$select id from teacher where auth_id = auth.uid()$$;
      create policy teacher_select on teacher for select using(auth_id = auth.uid());
      create policy class_all on class for all using(teacher_id = my_teacher_id()) with check(teacher_id = my_teacher_id());
      create policy class_public_read on class for select using(true);
      create policy week_auth on week for all using(class_id in (select id from class where teacher_id = my_teacher_id())) with check(class_id in (select id from class where teacher_id = my_teacher_id()));
      create policy week_public_read on week for select using(true);`)
    expect(await run(c => c.tx.select({ id: schema.classes.id }).from(schema.classes))).toEqual([{ id: classId }])
    await expect(run(c => changeClassWeeks(c, otherClass, 'add'))).rejects.toThrow()
    expect(await run(c => c.tx.select({ id: schema.classes.id }).from(schema.classes), '00000000-0000-4000-8000-000000000012')).toEqual([{ id: otherClass }])
  })
})

it('generates schedule dates in UTC including leap day', () => {
  expect(sessionDates('2024-02-26', '2024-03-04', ['thu', 'mon'])).toEqual(['2024-02-26', '2024-02-29', '2024-03-04'])
  expect(() => sessionDates('2026-02-01', '2026-01-01', ['mon'])).toThrow()
})
