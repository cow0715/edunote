import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const token = '33333333-3333-4333-8333-333333333333', other = '44444444-4444-4444-8444-444444444444'
const key = 'a'.repeat(64), meta = (task: string) => JSON.stringify([{ key, task, model: 'test-model' }])
const migration = readFileSync('supabase/migrations/20261023113525_exam_bank_batch_imports.sql', 'utf8')

describe('exam Batch SQL migration, executed in local PostgreSQL', () => {
  let db: PGlite, original: string
  async function seed(kind: string) {
    const id = randomUUID()
    await db.query(`insert into public.pdf_import_job(id,teacher_id,kind,target_id,status,lease_token,lease_expires_at)
      values($1,gen_random_uuid(),$2,gen_random_uuid(),'running',$3,now()+interval '10 minutes')`, [id, kind, token])
    return id
  }
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.pdf_import_job(id uuid primary key,teacher_id uuid,kind text,target_id uuid,payload jsonb default '{}',
        status text check(status in ('queued','running','succeeded','failed')),stage text,lease_token uuid,lease_expires_at timestamptz,
        attempt integer default 0,error text,updated_at timestamptz default now());
      create table public.exam_bank(id uuid primary key,teacher_id uuid);
      create table public.book_pdf_document(id uuid primary key,exam_bank_id uuid,teacher_id uuid);
      grant all on public.pdf_import_job,public.exam_bank,public.book_pdf_document to service_role;`)
    await db.exec(readFileSync('supabase/migrations/20261021150000_book_pdf_batches.sql', 'utf8'))
    const id = await seed('bank_book')
    const row = (await db.query<{ id: string }>('select * from public.book_pdf_batch_prepare($1,$2,$3)', [id, token, meta('book.mapSource')])).rows[0]
    original = row.id
    await db.query("select public.book_pdf_batch_update($1,$2,$3,'submitted','msgbatch_existing','{}')", [id, token, original])
    await db.exec(migration); await db.exec(migration)
  }, 120000)
  afterAll(async () => { await db?.close() })

  it('retains already submitted textbook provider IDs when applied twice', async () => {
    expect((await db.query('select provider_id,state from public.book_pdf_batch where id=$1', [original])).rows).toEqual([{ provider_id: 'msgbatch_existing', state: 'submitted' }])
  })
  it.each([['bank_questions', 'examBank.parseQuestions'], ['bank_explanation', 'examBank.extractExplanations'], ['bank_book', 'book.mapSource']])('supports leases, submission and delayed resume for %s', async (kind, task) => {
    const id = await seed(kind)
    await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)', [id, other, meta(task)])).rejects.toThrow('lease lost')
    const row = (await db.query<{ id: string }>('select * from public.book_pdf_batch_prepare($1,$2,$3)', [id, token, meta(task)])).rows[0]
    const provider = `msgbatch_${kind}`
    await db.query("select public.book_pdf_batch_update($1,$2,$3,'submitted',$4,'{}')", [id, token, row.id, provider])
    expect((await db.query<{ ok: boolean }>("select public.pdf_import_suspend_batch($1,$2,now()+interval '5 minutes') as ok", [id, token])).rows[0].ok).toBe(true)
    expect((await db.query('select * from public.pdf_import_claim($1,$2)', [id, other])).rows).toHaveLength(0)
    await db.query("update public.pdf_import_job set resume_after=now()-interval '1 second' where id=$1", [id])
    expect((await db.query('select * from public.pdf_import_claim($1,$2)', [id, other])).rows).toHaveLength(1)
    await db.query("select public.book_pdf_batch_update($1,$2,$3,'ended',$4,'{}')", [id, other, row.id, provider])
  })
  it('keeps weekly jobs and unrelated task types outside Batch', async () => {
    const week = await seed('week_answers')
    expect((await db.query<{ ok: boolean }>('select public.pdf_import_suspend_batch($1,$2,now()) as ok', [week, token])).rows[0].ok).toBe(false)
    await expect(db.query("update public.pdf_import_job set status='waiting_batch' where id=$1", [week])).rejects.toThrow('pdf_import_job_batch_wait_check')
    for (const [kind, task] of [['bank_explanation', 'examBank.parseQuestions'], ['bank_questions', 'week.gradeSubjective'], ['bank_book', 'examBank.extractExplanations']]) {
      const id = await seed(kind)
      await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)', [id, token, meta(task)])).rejects.toThrow('invalid batch task')
    }
  })
  it('preserves the durable three-submission limit and duplicate-active guard for exam requests', async () => {
    const id = await seed('bank_questions')
    for (let i = 0; i < 3; i++) {
      const row = (await db.query<{ id: string }>('select * from public.book_pdf_batch_prepare($1,$2,$3)', [id, token, meta('examBank.parseQuestions')])).rows[0]
      await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)', [id, token, meta('examBank.parseQuestions')])).rejects.toThrow(/already active|attempt limit/)
      await db.query("select public.book_pdf_batch_update($1,$2,$3,'rejected',null,'{}')", [id, token, row.id])
    }
    await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)', [id, token, meta('examBank.parseQuestions')])).rejects.toThrow('attempt limit')
  })
  it('keeps batch metadata and RPCs restricted to the worker service role', async () => {
    await db.exec('set role service_role')
    try { expect((await db.query('select provider_id from public.book_pdf_batch where id=$1', [original])).rows).toHaveLength(1) }
    finally { await db.exec('reset role') }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      try {
        await expect(db.query('select * from public.book_pdf_batch')).rejects.toThrow('permission denied')
        await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)', [randomUUID(), token, meta('vocab.enrich')])).rejects.toThrow('permission denied')
      } finally { await db.exec('reset role') }
    }
  })
})
