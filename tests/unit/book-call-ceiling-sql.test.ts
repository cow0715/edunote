import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

describe('durable document call ceiling with existing cost and bundle wrappers', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table pdf_import_job(id uuid primary key,teacher_id uuid,kind text,target_id uuid,payload jsonb default '{}',status text,stage text,lease_token uuid,lease_expires_at timestamptz,attempt int default 0,error text,updated_at timestamptz default now());
      create table book_pdf_document(id uuid primary key,teacher_id uuid,exam_bank_id uuid,manifest jsonb,status text default 'processing',title text default 'fixture');
      create table book_pdf_unit(document_id uuid,unit_key text,version int default 1,verified_version int,verification jsonb,enrichment jsonb,primary key(document_id,unit_key));
      create table exam_bank(id uuid primary key,teacher_id uuid);
      create table pdf_import_checkpoint(job_id uuid,call_key text,value jsonb,created_at timestamptz default now(),primary key(job_id,call_key));`)
    for (const file of ['20261021150000_book_pdf_batches.sql', '20261023113525_exam_bank_batch_imports.sql', '20261021000001_cost_management.sql', '20261029113902_book_pdf_cost_controls.sql', '20261030115616_book_import_bundles.sql', '20261030130000_book_batch_call_ceiling.sql', '20261030130000_book_batch_call_ceiling.sql']) {
      await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'))
    }
  }, 120000)
  afterAll(async () => { await db?.close() })
  async function fixture() {
    const doc = randomUUID(), job = randomUUID(), token = randomUUID()
    await db.query('insert into book_pdf_document(id) values($1)', [doc])
    await db.query(`insert into pdf_import_job(id,target_id,kind,status,lease_token,lease_expires_at) values($1,$2,'bank_book','running',$3,now()+interval '1 hour')`, [job, doc, token])
    await db.query('insert into book_pdf_cost_control(document_id,call_limit) values($1,2)', [doc])
    return { doc, job, token }
  }
  async function prepare(f: Awaited<ReturnType<typeof fixture>>, n: number) {
    return db.query('select * from book_pdf_batch_prepare($1,$2,$3)', [f.job, f.token, JSON.stringify([{ key: n.toString(16).padStart(64, 'a'), task: 'book.mapSource', model: 'claude-sonnet-5-5', unitKey: 'unit-1', maxOutputTokens: 100 }])])
  }
  it('counts requests across jobs, prompt keys and rejected/uncertain submissions', async () => {
    const f = await fixture()
    await prepare(f, 1)
    await db.query(`update book_pdf_batch set state='rejected' where job_id=$1`, [f.job])
    await db.query(`update pdf_import_job set status='failed' where id=$1`, [f.job])
    const next = { ...f, job: randomUUID() }
    await db.query(`insert into pdf_import_job(id,target_id,kind,status,lease_token,lease_expires_at) values($1,$2,'bank_book','running',$3,now()+interval '1 hour')`, [next.job, f.doc, f.token])
    await prepare(next, 2)
    await expect(prepare(next, 3)).rejects.toThrow('cumulative call limit')
    const result = (await db.query<{ info: { calls_used: number; call_limit: number } }>('select book_pdf_cost_summary($1,$2) info', [next.job, next.token])).rows[0].info
    expect(result).toMatchObject({ calls_used: 2, call_limit: 2 })
  })
  it('serializes concurrent claims against the same document', async () => {
    const f = await fixture()
    const outcomes = await Promise.allSettled([prepare(f, 11), prepare(f, 12), prepare(f, 13)])
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(2)
    expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1)
  })
  it('still reserves the dollar budget for the last permitted batch', async () => {
    const f = await fixture()
    await db.query('update book_pdf_cost_control set call_limit=1 where document_id=$1', [f.doc])
    const prepared = await prepare(f, 31)
    const batch = (prepared.rows[0] as { id: string }).id
    const estimates = [{ key: (31).toString(16).padStart(64, 'a'), unitKey: 'unit-1', inputLimit: 1000, maxOutputTokens: 100 }]
    const reserved = (await db.query<{ info: { allowed: boolean } }>('select book_pdf_cost_reserve($1,$2,$3,$4,$5) info', [f.job, f.token, batch, JSON.stringify(estimates), 'a'.repeat(64)])).rows[0].info
    expect(reserved.allowed).toBe(true)
    await expect(prepare(f, 32)).rejects.toThrow('cumulative call limit')
  })
  it('never gives authenticated clients access to the guard or its original function', async () => {
    const f = await fixture()
    await db.exec('set role authenticated')
    try {
      await expect(prepare(f, 21)).rejects.toThrow('permission denied')
      await expect(db.query('select * from book_pdf_batch_prepare_before_call_cap($1,$2,$3)', [f.job, f.token, '[]'])).rejects.toThrow('permission denied')
    } finally { await db.exec('reset role') }
  })
})
