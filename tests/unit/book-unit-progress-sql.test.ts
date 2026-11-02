import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { withPdfWorkerContext } from '@/lib/pdf-import/context'
import { readBookUnitStage, writeBookUnitStage } from '@/lib/book-pdf/unit-progress'

const migration = '20261101102036_book_unit_progress_and_request_guard.sql'
describe('leased textbook progress and atomic evidence guard', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table pdf_import_job(id uuid primary key,teacher_id uuid,kind text,target_id uuid,payload jsonb default '{}',status text,stage text,lease_token uuid,lease_expires_at timestamptz,attempt int default 0,error text,updated_at timestamptz default now());
      create table book_pdf_document(id uuid primary key,teacher_id uuid,source_sha256 text,exam_bank_id uuid,manifest jsonb,status text default 'processing',title text default 'fixture');
      create table book_pdf_unit(document_id uuid,unit_key text,version int default 1,verified_version int,verification jsonb,enrichment jsonb,primary key(document_id,unit_key));
      create table exam_bank(id uuid primary key,teacher_id uuid);
      create table pdf_import_checkpoint(job_id uuid,call_key text,value jsonb,created_at timestamptz default now(),primary key(job_id,call_key));`)
    for (const file of ['20261021150000_book_pdf_batches.sql', '20261023113525_exam_bank_batch_imports.sql', '20261021000001_cost_management.sql', '20261029113902_book_pdf_cost_controls.sql', '20261030115616_book_import_bundles.sql', '20261030130000_book_batch_call_ceiling.sql', migration, migration]) {
      await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'))
    }
  }, 120000)
  afterAll(async () => { await db?.close() })
  async function fixture() {
    const doc = randomUUID(), job = randomUUID(), token = randomUUID()
    await db.query('insert into book_pdf_document(id,source_sha256) values($1,$2)', [doc, 'a'.repeat(64)])
    await db.query(`insert into pdf_import_job(id,target_id,kind,status,lease_token,lease_expires_at) values($1,$2,'bank_book','running',$3,now()+interval '1 hour')`, [job, doc, token])
    await db.query(`insert into book_pdf_unit(document_id,unit_key) values($1,'unit-1')`, [doc])
    return { doc, job, token }
  }
  const meta = (n = 1, semantic = 'c'.repeat(64)) => ({ key: n.toString(16).padStart(64, 'a'), semanticKey: semantic, task: 'book.mapSource', model: 'claude-sonnet-5-5', unitKey: 'unit-1', maxOutputTokens: 100 })
  const prepare = (f: Awaited<ReturnType<typeof fixture>>, items = [meta()]) => db.query<{ id: string }>('select * from book_pdf_batch_prepare($1,$2,$3)', [f.job, f.token, JSON.stringify(items)])
  it('blocks different prompt keys for the same evidence across concurrent and replacement jobs', async () => {
    const f = await fixture()
    const results = await Promise.allSettled([prepare(f, [meta(1)]), prepare(f, [meta(2)])])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    await db.query(`update pdf_import_job set status='failed' where id=$1`, [f.job])
    const next = { ...f, job: randomUUID() }
    await db.query(`insert into pdf_import_job(id,target_id,kind,status,lease_token,lease_expires_at) values($1,$2,'bank_book','running',$3,now()+interval '1 hour')`, [next.job, f.doc, f.token])
    await expect(prepare(next, [meta(3)])).rejects.toThrow('duplicate or uncertain')
  })
  it('permits only the same transiently failed request, still within the old three-attempt limit', async () => {
    const f = await fixture()
    for (let n = 0; n < 3; n++) {
      const row = (await prepare(f)).rows[0]
      await db.query(`update book_pdf_batch set state='ended',outcomes=$1 where id=$2`, [JSON.stringify({ [meta().key]: 'api_error' }), row.id])
    }
    await expect(prepare(f)).rejects.toThrow('attempt limit')
    await expect(prepare(f, [meta(2)])).rejects.toThrow('duplicate or uncertain')
  })
  it('does not rebill a successful result even if its response checkpoint is missing', async () => {
    const f = await fixture(), row = (await prepare(f)).rows[0]
    await db.query(`update book_pdf_batch set state='ended',outcomes=$1 where id=$2`, [JSON.stringify({ [meta().key]: 'succeeded' }), row.id])
    await expect(prepare(f)).rejects.toThrow('duplicate or uncertain')
    await expect(prepare(f, [meta(2)])).rejects.toThrow('duplicate or uncertain')
  })
  it('protects aliases for old paid responses and rejects duplicate evidence within one batch', async () => {
    const f = await fixture()
    await db.query('insert into pdf_import_checkpoint(job_id,call_key,value) values($1,$2,$3)', [f.job, 'book-semantic-result:v1:' + meta().semanticKey, '{}'])
    await expect(prepare(f)).rejects.toThrow('already received')
    await expect(prepare(f, [meta(2, 'd'.repeat(64)), meta(3, 'd'.repeat(64))])).rejects.toThrow('duplicate textbook evidence')
    await expect(prepare(f, [{ ...meta(4), semanticKey: '' }])).rejects.toThrow('semantic identity')
  })
  it('advances progress without touching paid checkpoints; seals accepted source and complete stages', async () => {
    const f = await fixture(), key = 'book-unit-stage:v1:' + 'f'.repeat(64)
    const value = { version: 1, unitKey: 'unit-1', scope: { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }, stage: 'mapping', json: '{"attempt":1}', hash: 'c'.repeat(64) }
    const save = (v: unknown, k = key, token = f.token) => db.query('select book_pdf_save_unit_progress($1,$2,$3,$4,$5)', [f.job, token, 'unit-1', k, JSON.stringify(v)])
    await db.query('insert into pdf_import_checkpoint(job_id,call_key,value) values($1,$2,$3)', [f.job, 'batch-result:paid', '{"original":true}'])
    await save(value); await save({ ...value, json: '{"attempt":2}' })
    expect((await db.query<{ value: { json: string } }>('select value from pdf_import_checkpoint where job_id=$1 and call_key=$2', [f.job, key])).rows[0].value.json).toBe('{"attempt":2}')
    await expect(save(value, 'batch-result:paid')).rejects.toThrow('invalid textbook progress')
    await expect(save(value, key, randomUUID())).rejects.toThrow('lease lost')
    await expect(save({ ...value, scope: { ...value.scope, pdfHash: 'd'.repeat(64) } })).rejects.toThrow('invalid textbook progress')
    const accepted = { ...value, stage: 'source' }, acceptedKey = 'book-unit-stage:v1:' + 'e'.repeat(64)
    await save(accepted, acceptedKey)
    await expect(save({ ...accepted, json: '{"changed":true}' }, acceptedKey)).rejects.toThrow('cannot be replaced')
    expect((await db.query<{ value: unknown }>(`select value from pdf_import_checkpoint where job_id=$1 and call_key='batch-result:paid'`, [f.job])).rows[0].value).toEqual({ original: true })
  })
  it('requires a live book lease and keeps progress/guard RPCs private', async () => {
    const f = await fixture()
    expect((await db.query<{ info: { unit_guard_version: number } }>('select book_pdf_cost_summary($1,$2) info', [f.job, f.token])).rows[0].info.unit_guard_version).toBe(1)
    await db.exec('set role authenticated')
    try { await expect(prepare(f)).rejects.toThrow('permission denied') } finally { await db.exec('reset role') }
  })
  it('stores a durable held result in the deployed progress contract without changing its stage whitelist', async () => {
    const f = await fixture(), scope = { pdfHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64) }
    const held = { questions: ['1강 1번'], stage: 'audit', status: 'held', reasons: ['원문 불일치'], heldResult: { verification: { status: 'unresolved', failure: { stage: 'audit', attempt_id: null } } } }
    await withPdfWorkerContext({ unitKey: 'unit-1', signal: new AbortController().signal, concurrency: 1, execute: fn => fn(), stage: async () => {},
      write: async () => { throw Error('paid checkpoints must stay immutable') },
      read: async <T>(key: string) => (await db.query<{ value: T }>('select value from pdf_import_checkpoint where job_id=$1 and call_key=$2', [f.job, key])).rows[0]?.value ?? null,
      writeBookProgress: async (key, value) => { await db.query('select book_pdf_save_unit_progress($1,$2,$3,$4,$5)', [f.job, f.token, 'unit-1', key, JSON.stringify(value)]) },
    }, async () => {
      await writeBookUnitStage(scope, 'progress', held)
      expect(await readBookUnitStage(scope, 'progress')).toEqual(held)
    })
  })
})
