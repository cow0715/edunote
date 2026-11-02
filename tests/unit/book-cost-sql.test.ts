import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const migration = 'supabase/migrations/20261029113902_book_pdf_cost_controls.sql'
describe('atomic file budgets and billed Batch usage', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.pdf_import_job(id uuid primary key,teacher_id uuid,kind text,target_id uuid,payload jsonb default '{}',status text,stage text,
       lease_token uuid,lease_expires_at timestamptz,attempt int default 0,error text,updated_at timestamptz default now());
      create table public.book_pdf_document(id uuid primary key,teacher_id uuid,exam_bank_id uuid);
      create table public.exam_bank(id uuid primary key,teacher_id uuid);
      create table public.pdf_import_checkpoint(job_id uuid,call_key text,value jsonb,created_at timestamptz default now(),primary key(job_id,call_key));
      grant all on public.pdf_import_job,public.book_pdf_document,public.exam_bank,public.pdf_import_checkpoint to service_role;`)
    for (const name of ['20261021150000_book_pdf_batches.sql','20261023113525_exam_bank_batch_imports.sql','20261021000001_cost_management.sql','20261029113902_book_pdf_cost_controls.sql']) {
      await db.exec(readFileSync('supabase/migrations/'+name,'utf8'))
    }
    await db.exec(readFileSync(migration,'utf8'))
  },120000)
  afterAll(async () => { await db?.close() })
  async function fixture() {
    const job=randomUUID(),doc=randomUUID(),token=randomUUID()
    await db.query('insert into book_pdf_document(id) values($1)',[doc])
    await db.query(`insert into pdf_import_job(id,target_id,kind,status,lease_token,lease_expires_at) values($1,$2,'bank_book','running',$3,now()+interval '1 hour')`,[job,doc,token])
    return {job,doc,token}
  }
  const key=(n:number)=>n.toString(16).padStart(64,'a')
  async function prepare(f: Awaited<ReturnType<typeof fixture>>,n:number,input=1000,output=1000) {
    const meta=[{key:key(n),task:'book.mapSource',model:'claude-sonnet-5-5',unitKey:`unit-${n}`,maxOutputTokens:output}]
    const batch=(await db.query<{id:string}>('select * from book_pdf_batch_prepare($1,$2,$3)',[f.job,f.token,JSON.stringify(meta)])).rows[0].id
    const estimates=[{key:key(n),unitKey:`unit-${n}`,inputLimit:input,maxOutputTokens:output}]
    return {batch,estimates,meta}
  }
  const reserve=async(f:Awaited<ReturnType<typeof fixture>>,p:Awaited<ReturnType<typeof prepare>>,protocol='a'.repeat(64)) =>
    (await db.query<{info:{allowed:boolean,reason:string,reserved_usd:number,spent_usd:number}}>('select book_pdf_cost_reserve($1,$2,$3,$4,$5) info',[f.job,f.token,p.batch,JSON.stringify(p.estimates),protocol])).rows[0].info
  it('reserves a full output ceiling and counts another outstanding batch against the same file cap',async()=>{
    const f=await fixture(),p=await prepare(f,1,1000000,32768)
    await db.query('insert into book_pdf_cost_control(document_id,limit_usd) values($1,1.2)',[f.doc])
    expect((await reserve(f,p)).allowed).toBe(true)
    const second=await prepare(f,2,1000000,32768)
    expect(await reserve(f,second)).toMatchObject({allowed:false,reason:'file_budget_exceeded'})
    expect((await db.query('select * from pdf_batch_request_cost where batch_id=$1',[second.batch])).rows).toHaveLength(0)
  })
  it('keeps spend through a new job and latches protocol changes before a new paid reservation',async()=>{
    const f=await fixture(),p=await prepare(f,3)
    await reserve(f,p)
    const q=await prepare(f,4)
    expect(await reserve(f,q,'b'.repeat(64))).toMatchObject({allowed:false,reason:'protocol_changed'})
    await db.query(`update pdf_import_job set status='failed' where id=$1`,[f.job])
    const newer={...f,job:randomUUID()}
    await db.query(`insert into pdf_import_job(id,target_id,kind,status,lease_token,lease_expires_at) values($1,$2,'bank_book','running',$3,now()+interval '1 hour')`,[newer.job,f.doc,f.token])
    expect((await db.query<{v:{reason:string}}>('select book_pdf_cost_summary($1,$2) v',[newer.job,f.token])).rows[0].v.reason).toBe('protocol_changed')
  })
  it('settles actual billed tokens, records the Batch tier once, and does not count checkpoint reads as new usage',async()=>{
    const f=await fixture(),p=await prepare(f,5)
    await reserve(f,p)
    const result={usage:{inputTokens:1000,outputTokens:100,cacheReadTokens:0,cacheWriteTokens:0},execution:{responseModel:'claude-sonnet-5-5',batchId:'msgbatch_test'}}
    await db.query(`insert into pdf_import_checkpoint(job_id,call_key,value,created_at) values($1,$2,$3,'2026-10-21T12:00:00Z')`,[f.job,'batch-result:'+key(5),JSON.stringify({result})])
    await db.query(`update book_pdf_batch set state='ended',provider_id='msgbatch_test',outcomes=$2 where id=$1`,[p.batch,JSON.stringify({[key(5)]:'succeeded'})])
    for(let i=0;i<2;i++)await db.query('select pdf_batch_record_usage($1,$2,$3,$4)',[f.job,f.token,p.batch,'test'])
    const events=(await db.query<{service_tier:string,occurred_at:Date}>('select * from cost_usage_event where request_id=$1',['pdf-batch:'+p.batch+':'+key(5)])).rows
    expect(events).toHaveLength(1);expect(events[0].service_tier).toBe('batch')
    expect(new Date(events[0].occurred_at).toISOString()).toBe('2026-10-21T12:00:00.000Z')
    const summary=(await db.query<{s:{spent_usd:number,reserved_usd:number}}>('select book_pdf_cost_summary($1,$2) s',[f.job,f.token])).rows[0].s
    expect(Number(summary.spent_usd)).toBeCloseTo(0.0015);expect(Number(summary.reserved_usd)).toBe(0)
  })
  it('deduplicates unit outcomes across restarts and stops before further charges at the failure threshold',async()=>{
    const f=await fixture()
    for(let n=1;n<=10;n++)for(let i=0;i<2;i++)await db.query('select book_pdf_cost_quality($1,$2,$3,$4)',[f.job,f.token,`unit-${n}`,n<=3?'failed':'passed'])
    const info=(await db.query<{s:{allowed:boolean,reason:string}}>('select book_pdf_cost_summary($1,$2) s',[f.job,f.token])).rows[0].s
    expect(info).toMatchObject({allowed:false,reason:'quality_failure_rate'})
  })
  it('stops at the repair threshold even when every request returned a valid provider response',async()=>{
    const f=await fixture()
    for(let n=1;n<=10;n++)await db.query('select book_pdf_cost_quality($1,$2,$3,$4)',[f.job,f.token,`unit-${n}`,n<=4?'repair':'passed'])
    expect((await db.query<{s:{reason:string}}>('select book_pdf_cost_summary($1,$2) s',[f.job,f.token])).rows[0].s.reason).toBe('quality_repair_rate')
  })
  it('rejects stale leases and authenticated access to cost reservations',async()=>{
    const f=await fixture(),p=await prepare(f,6)
    await expect(db.query('select book_pdf_cost_reserve($1,$2,$3,$4,$5)',[f.job,randomUUID(),p.batch,JSON.stringify(p.estimates),'a'.repeat(64)])).rejects.toThrow('lease lost')
    await db.exec('set role authenticated')
    try{
      await expect(db.query('select * from book_pdf_cost_control')).rejects.toThrow('permission denied')
      await expect(db.query('select book_pdf_cost_summary($1,$2)',[f.job,f.token])).rejects.toThrow('permission denied')
    }finally{await db.exec('reset role')}
  })
  it('refuses an older worker that has no cost-aware unit metadata',async()=>{
    const f=await fixture()
    await expect(db.query('select * from book_pdf_batch_prepare($1,$2,$3)',[f.job,f.token,JSON.stringify([{key:key(8),task:'book.mapSource',model:'claude-sonnet-5-5'}])])).rejects.toThrow('cost-aware worker required')
  })
  it('backfills historical responses idempotently without attributing a later success to an earlier expired attempt',async()=>{
    const f=await fixture(),p=await prepare(f,7)
    const succeededId='msgbatch_backfill'
    const result={usage:{inputTokens:1000,outputTokens:100,cacheReadTokens:0,cacheWriteTokens:0},execution:{responseModel:'claude-sonnet-5-5',batchId:succeededId}}
    await db.query('insert into pdf_import_checkpoint(job_id,call_key,value) values($1,$2,$3)',[f.job,'batch-result:'+key(7),JSON.stringify({result})])
    await db.query(`update book_pdf_batch set state='ended',provider_id=$2,outcomes=$3 where id=$1`,[p.batch,succeededId,JSON.stringify({[key(7)]:'succeeded'})])
    const expired=randomUUID()
    await db.query(`insert into book_pdf_batch(id,job_id,state,provider_id,requests,outcomes) values($1,$2,'ended','msgbatch_expired',$3,$4)`,[expired,f.job,JSON.stringify(p.meta),JSON.stringify({[key(7)]:'expired'})])
    await db.exec(readFileSync(migration,'utf8'))
    await db.query(`select pdf_batch_backfill_usage('test')`);await db.query(`select pdf_batch_backfill_usage('test')`)
    const rows=(await db.query('select * from cost_usage_event where request_id like $1',['pdf-batch:'+p.batch+':%'])).rows
    expect(rows).toHaveLength(1)
    expect((await db.query('select * from cost_usage_event where request_id like $1',['pdf-batch:'+expired+':%'])).rows).toHaveLength(0)
    const info=(await db.query<{s:{spent_usd:number,reason:string}}>('select book_pdf_cost_summary($1,$2) s',[f.job,f.token])).rows[0].s
    expect(Number(info.spent_usd)).toBeCloseTo(0.0015);expect(info.reason).toBe('legacy_review_required')
  })
  it('includes historical standard calls in the same file budget while excluding ordinary Batch checkpoint copies',async()=>{
    const f=await fixture(),usage={inputTokens:1000,outputTokens:100,cacheReadTokens:0,cacheWriteTokens:0}
    for(const [name,transport] of [['standard','standard'],['batch-copy','batch']])await db.query(
      'insert into pdf_import_checkpoint(job_id,call_key,value) values($1,$2,$3)',[f.job,name,JSON.stringify({usage,execution:{responseModel:'claude-sonnet-5-5',transport}})])
    await db.exec(readFileSync(migration,'utf8'));await db.exec(readFileSync(migration,'utf8'))
    const info=(await db.query<{s:{spent_usd:number,reason:string}}>('select book_pdf_cost_summary($1,$2) s',[f.job,f.token])).rows[0].s
    expect(Number(info.spent_usd)).toBeCloseTo(0.003);expect(info.reason).toBe('legacy_review_required')
  })
})
