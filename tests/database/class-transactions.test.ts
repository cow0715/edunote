import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { changeClassWeeks, updateWeek } from '@/lib/services/class-weeks'
import { managePeriod } from '@/lib/services/class-periods'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ pool: undefined as Pool | undefined }))
vi.mock('@/lib/db/pool', () => ({ getPool: () => state.pool }))
let admin: Pool
const user = '00000000-0000-4000-8000-000000000011'
const classId = '00000000-0000-4000-8000-000000000021'
beforeAll(async () => {
  const value = process.env.LOCAL_TRANSACTION_TEST_URL
  if (!value) throw new Error('Run through scripts/verify-transactions-local.mjs')
  const url = new URL(value)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/edunote_tx_test') throw new Error('Refusing non-local or non-test database')
  admin = new Pool({ connectionString: value })
  await admin.query(readFileSync('tests/fixtures/transaction-schema.sql', 'utf8'))
  await admin.query(readFileSync('supabase/migrations/20260929101449_server_transaction_role.sql', 'utf8'))
  await admin.query("alter role edunote_app login password 'local-tests-only'")
  url.username = 'edunote_app'
  url.password = 'local-tests-only'
  state.pool = new Pool({ connectionString: url.toString(), max: 5 })
})
afterAll(async () => { await state.pool?.end(); await admin?.end() })

it('serializes concurrent additions on the same class without duplicate numbers', async () => {
  await Promise.all(Array.from({ length: 8 }, () => withTeacherTransaction(user, c => changeClassWeeks(c, classId, 'add'))))
  const { rows } = await admin.query('select week_number from week order by week_number')
  expect(rows.map(row => row.week_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})

it('keeps a contiguous sequence during overlapping move, sync and extension', async () => {
  const { rows: [week] } = await admin.query('select id from week order by week_number limit 1')
  await Promise.all([
    withTeacherTransaction(user, c => updateWeek(c, week.id, { start_date: '2026-01-06' })),
    withTeacherTransaction(user, c => changeClassWeeks(c, classId, 'sync')),
    withTeacherTransaction(user, c => changeClassWeeks(c, classId, 'extend', { count: 3 })),
  ])
  const { rows } = await admin.query('select week_number from week order by week_number')
  expect(rows.map(row => row.week_number)).toEqual(rows.map((_, i) => i + 1))
  expect((await admin.query('select count(*)::int as n from week where start_date is null')).rows[0].n).toBe(7)
})

it('keeps exactly one default with concurrent default changes', async () => {
  const first = await withTeacherTransaction(user, c => managePeriod(c, classId, 'create', undefined, { label: 'first', semester: 1, start_date: '2026-01-01' }))
  const second = await withTeacherTransaction(user, c => managePeriod(c, classId, 'create', undefined, { label: 'second', semester: 2, start_date: '2026-07-01' }))
  if (!('id' in first) || !('id' in second)) throw new Error('fixture')
  const before = (await admin.query('select id,start_date::text,end_date::text from class_period order by id')).rows
  await Promise.all([first.id, second.id].map(id => withTeacherTransaction(user, c => managePeriod(c, classId, 'set_default', id))))
  expect((await admin.query('select count(*)::int as n from class_period where is_current')).rows[0].n).toBe(1)
  expect((await admin.query('select id,start_date::text,end_date::text from class_period order by id')).rows).toEqual(before)
})

it('rolls back actual pg writes and does not leak identity into reused pool connections', async () => {
  const before = (await admin.query('select count(*)::int as n from week')).rows[0].n
  await expect(withTeacherTransaction(user, async c => {
    await changeClassWeeks(c, classId, 'add')
    throw new Error('injected failure')
  })).rejects.toThrow('injected failure')
  expect((await admin.query('select count(*)::int as n from week')).rows[0].n).toBe(before)
  const other = await withTeacherTransaction('00000000-0000-4000-8000-000000000012', c => c.tx.execute(sql`select id from public.class`))
  expect(other.rows).toEqual([{ id: '00000000-0000-4000-8000-000000000022' }])
  expect((await state.pool!.query('select id from public.class')).rows).toEqual([])
  await expect(withTeacherTransaction('00000000-0000-4000-8000-000000000099', c => changeClassWeeks(c, classId, 'add'))).rejects.toMatchObject({ status: 403 })
})
