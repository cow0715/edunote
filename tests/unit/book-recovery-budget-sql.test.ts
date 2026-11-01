import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migration = '20261101111724_book_recovery_budget_authorization.sql'
describe('scope-bound existing-book recovery budgets', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table pdf_import_job(id uuid primary key,teacher_id uuid,kind text,target_id uuid,payload jsonb default '{}',status text,stage text,lease_token uuid,lease_expires_at timestamptz,attempt int default 0,error text,updated_at timestamptz default now());
      create table book_pdf_document(id uuid primary key,teacher_id uuid,source_sha256 text,exam_bank_id uuid,manifest jsonb,status text default 'processing',title text default 'fixture');
      create table book_pdf_unit(document_id uuid,unit_key text,version int default 1,verified_version int,verification jsonb,enrichment jsonb,primary key(document_id,unit_key));
      create table exam_bank(id uuid primary key,teacher_id uuid);
      create table pdf_import_checkpoint(job_id uuid,call_key text,value jsonb,created_at timestamptz default now(),primary key(job_id,call_key));
      grant all on pdf_import_job,book_pdf_document,book_pdf_unit,exam_bank,pdf_import_checkpoint to service_role;`)
    for (const name of ['20261021150000_book_pdf_batches.sql','20261023113525_exam_bank_batch_imports.sql','20261021000001_cost_management.sql','20261029113902_book_pdf_cost_controls.sql','20261030115616_book_import_bundles.sql','20261030130000_book_batch_call_ceiling.sql','20261101102036_book_unit_progress_and_request_guard.sql',migration,migration]) await db.exec(readFileSync('supabase/migrations/'+name,'utf8'))
  }, 120000)
  afterAll(async () => { await db?.close() })
  async function fixture() {
    const teacher=randomUUID(), registration=randomUUID(), request=randomUUID(), approval=randomUUID(), files=[0,1,2,3].map(n=>({fileName:n+'.pdf'}))
    const bundle=(await db.query<{v:{id:string}}>('select book_pdf_bundle_open($1,$2,$3,$4) v',[teacher,request,JSON.stringify(files),registration])).rows[0].v.id
    const jobs=[]
    for(let n=0;n<4;n++) {
      const doc=randomUUID(),job=randomUUID(),hash=(n+1).toString().repeat(64)
      await db.query('insert into book_pdf_document(id,teacher_id,source_sha256) values($1,$2,$3)',[doc,teacher,hash])
      await db.query(`insert into pdf_import_job(id,teacher_id,target_id,kind,status,payload) values($1,$2,$3,'bank_book','failed','{"original":true}')`,[job,teacher,doc])
      await db.query('select book_pdf_bundle_attach($1,$2,$3,$4,$5)',[bundle,registration,n,doc,job])
      await db.query('insert into book_pdf_cost_control(document_id) values($1)',[doc])
      jobs.push({position:n,document_id:doc,job_id:job,pdf_hash:hash,limit_usd:[14,9,12,14][n]})
    }
    const authorization={kind:'existing-job-recovery-v1',approval_id:approval,total_limit_usd:49,bundle_files:files,jobs}
    return {bundle,teacher,request,registration,files,jobs,authorization}
  }
  it('keeps new registration at five dollars per file and rejects a normal bundle over twenty',async()=>{
    const f=await fixture()
    expect((await db.query<{limit_usd:string}>('select limit_usd from book_pdf_bundle where id=$1',[f.bundle])).rows[0].limit_usd).toBe('20.000000')
    await expect(db.query('update book_pdf_bundle set limit_usd=49 where id=$1',[f.bundle])).rejects.toThrow('check constraint')
    expect((await db.query<{limit_usd:string}>('select limit_usd from book_pdf_cost_control where document_id=$1',[f.jobs[0].document_id])).rows[0].limit_usd).toBe('5.000000')
  })
  it('allows only a complete approval for the exact files/caps and cannot transfer that approval',async()=>{
    const f=await fixture()
    await db.query('update book_pdf_bundle set recovery_authorization=$1,limit_usd=49 where id=$2',[JSON.stringify(f.authorization),f.bundle])
    await expect(db.query('update book_pdf_bundle set limit_usd=50 where id=$1',[f.bundle])).rejects.toThrow('check constraint')
    await expect(db.query('update book_pdf_bundle set files=$1 where id=$2',[JSON.stringify([...f.files].reverse()),f.bundle])).rejects.toThrow('immutable')
    await expect(db.query('update book_pdf_bundle set recovery_authorization=null where id=$1',[f.bundle])).rejects.toThrow('immutable')
    await expect(db.query('update book_pdf_bundle set teacher_id=$1 where id=$2',[randomUUID(),f.bundle])).rejects.toThrow('immutable')
    await expect(db.query('update book_pdf_bundle_file set job_id=$1 where bundle_id=$2 and position=0',[f.jobs[1].job_id,f.bundle])).rejects.toThrow('immutable')
    await db.query(`update book_pdf_bundle_file set phase='pilot' where bundle_id=$1`,[f.bundle])
  })
  it('rejects missing/forged scope and altered file caps',async()=>{
    const f=await fixture()
    for(const auth of [{}, {...f.authorization,total_limit_usd:null}, {...f.authorization,jobs:f.authorization.jobs.map((j,n)=>n?j:{...j,position:null})},
      {...f.authorization,jobs:f.authorization.jobs.map((j,n)=>n?j:{...j,limit_usd:15})},
      {...f.authorization,jobs:f.authorization.jobs.map(j=>({...j,document_id:f.jobs[0].document_id}))}]) {
      expect((await db.query<{valid:boolean}>('select book_pdf_recovery_budget_valid($1,$2,49) valid',[JSON.stringify(auth),JSON.stringify(f.files)])).rows[0].valid).toBe(false)
    }
  })
  it('can connect stopped jobs without claiming them or altering immutable paid replies',async()=>{
    const f=await fixture(),before=(await db.query('select id,status,attempt,lease_token,lease_expires_at from pdf_import_job where teacher_id=$1 order by id',[f.teacher])).rows
    await db.query(`insert into pdf_import_checkpoint(job_id,call_key,value) values($1,'batch-result:paid','{"paid":true}')`,[f.jobs[0].job_id])
    await db.exec('begin')
    try {
      await db.query(`update book_pdf_bundle set recovery_authorization=$1,limit_usd=49,state='ready',stop_reason='manual_resume_required' where id=$2`,[JSON.stringify(f.authorization),f.bundle])
      for(const j of f.jobs){
        await db.query('update book_pdf_cost_control set limit_usd=$1 where document_id=$2',[j.limit_usd,j.document_id])
        await db.query(`update pdf_import_job set payload=payload||jsonb_build_object('bookProfile','jugis-two-column-v1','bundleId',$1::text) where id=$2`,[f.bundle,j.job_id])
      }
      await db.exec('commit')
    } catch(e){await db.exec('rollback');throw e}
    expect((await db.query('select id,status,attempt,lease_token,lease_expires_at from pdf_import_job where teacher_id=$1 order by id',[f.teacher])).rows).toEqual(before)
    expect((await db.query<{value:unknown}>('select value from pdf_import_checkpoint where job_id=$1',[f.jobs[0].job_id])).rows[0].value).toEqual({paid:true})
    expect((await db.query<{limit_usd:string}>('select limit_usd from book_pdf_cost_control where document_id=$1',[f.jobs[0].document_id])).rows[0].limit_usd).toBe('14.000000')
  })
  it('does not expose the recovery authorization helper to authenticated clients',async()=>{
    const f=await fixture();await db.exec('set role authenticated')
    try { await expect(db.query('select book_pdf_recovery_budget_valid($1,$2,49)',[JSON.stringify(f.authorization),JSON.stringify(f.files)])).rejects.toThrow('permission denied') }
    finally{await db.exec('reset role')}
  })
})
