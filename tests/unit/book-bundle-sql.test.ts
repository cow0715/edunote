import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const migration = 'supabase/migrations/20261030115616_book_import_bundles.sql'
describe('server-enforced textbook bundle gates', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table pdf_import_job(id uuid primary key,teacher_id uuid,kind text,target_id uuid,payload jsonb default '{}',status text,stage text,lease_token uuid,lease_expires_at timestamptz,attempt int default 0,error text,updated_at timestamptz default now());
      create table book_pdf_document(id uuid primary key,teacher_id uuid,exam_bank_id uuid,manifest jsonb,status text default 'processing',title text default 'fixture');
      create table book_pdf_unit(document_id uuid,unit_key text,version int default 1,verified_version int,verification jsonb,enrichment jsonb,primary key(document_id,unit_key));
      create table exam_bank(id uuid primary key,teacher_id uuid);
      create table pdf_import_checkpoint(job_id uuid,call_key text,value jsonb,created_at timestamptz default now(),primary key(job_id,call_key));
      grant all on pdf_import_job,book_pdf_document,book_pdf_unit,exam_bank,pdf_import_checkpoint to service_role;`)
    for (const name of ['20261021150000_book_pdf_batches.sql','20261023113525_exam_bank_batch_imports.sql','20261021000001_cost_management.sql','20261029113902_book_pdf_cost_controls.sql']) await db.exec(readFileSync('supabase/migrations/'+name,'utf8'))
    await db.exec(readFileSync(migration,'utf8')); await db.exec(readFileSync(migration,'utf8'))
  }, 120000)
  afterAll(async () => { await db?.close() })
  async function fixture(count=2, ready=true) {
    const teacher=randomUUID(), key=randomUUID(), registration=randomUUID()
    const files=Array.from({length:count},(_,n)=>({fileName:`${n}.pdf`}))
    const opened=(await db.query<{v:{id:string}}>('select book_pdf_bundle_open($1,$2,$3,$4) v',[teacher,key,JSON.stringify(files),registration])).rows[0].v
    const items=[]
    for(let n=0;n<count;n++) {
      const doc=randomUUID(),job=randomUUID(),token=randomUUID()
      await db.query('insert into book_pdf_document(id,teacher_id) values($1,$2)',[doc,teacher])
      await db.query(`insert into pdf_import_job(id,teacher_id,target_id,kind,status,lease_token,lease_expires_at) values($1,$2,$3,'bank_book','running',$4,now()+interval '1 hour')`,[job,teacher,doc,token])
      await db.query('select book_pdf_bundle_attach($1,$2,$3,$4,$5)',[opened.id,registration,n,doc,job])
      await db.query(`insert into book_pdf_unit(document_id,unit_key) values($1,'unit-1'),($1,'unit-2')`,[doc])
      items.push({doc,job,token})
    }
    if(ready)await db.query('select book_pdf_bundle_seal($1,$2)',[opened.id,registration])
    return {teacher,key,registration,files,bundle:opened.id,items}
  }
  type Item={doc:string;job:string;token:string}
  const plan={version:'jugis-two-column-v1',snapshot_hash:'a'.repeat(64),pdf_hash:'b'.repeat(64),unit_count:2,question_count:2,pilot_keys:['unit-1'],ambiguous_units:[]}
  async function preflight(f:Awaited<ReturnType<typeof fixture>>) { for(const i of f.items)await db.query('select book_pdf_profile_plan($1,$2,$3)',[i.job,i.token,JSON.stringify(plan)]) }
  async function summary(i:Item){return(await db.query<{v:{allowed:boolean;reason:string;bundle_spent_usd:number}}>('select book_pdf_cost_summary($1,$2) v',[i.job,i.token])).rows[0].v}
  async function reserve(i:Item,n:number,count=1,input=1000,output=1000){
    const keys=Array.from({length:count},(_,k)=>(n+k).toString(16).padStart(64,'a'))
    const meta=keys.map(key=>({key,task:'book.auditSource',model:'claude-sonnet-5-5',unitKey:'unit-1',maxOutputTokens:output}))
    const batch=(await db.query<{id:string}>('select * from book_pdf_batch_prepare($1,$2,$3)',[i.job,i.token,JSON.stringify(meta)])).rows[0].id
    const estimates=keys.map(key=>({key,unitKey:'unit-1',inputLimit:input,maxOutputTokens:output}))
    const result=(await db.query<{v:{allowed:boolean;reason:string}}>('select book_pdf_cost_reserve($1,$2,$3,$4,$5) v',[i.job,i.token,batch,JSON.stringify(estimates),'c'.repeat(64)])).rows[0].v
    return {batch,result}
  }
  it('requires every queued/running file preflight before any paid request',async()=>{
    const f=await fixture();await db.query('select book_pdf_profile_plan($1,$2,$3)',[f.items[0].job,f.items[0].token,JSON.stringify(plan)])
    expect(await summary(f.items[0])).toMatchObject({allowed:false,reason:'bundle_preparing'})
    await preflight(f);expect((await summary(f.items[0])).allowed).toBe(true)
  })
  it('locks combined spend across files and carries previous spend into a new bundle',async()=>{
    const f=await fixture();await preflight(f);await db.query('update book_pdf_bundle set limit_usd=.01 where id=$1',[f.bundle])
    const results=await Promise.all(f.items.map((item,n)=>reserve(item,10+n)))
    expect(results.filter(r=>r.result.allowed)).toHaveLength(1)
    expect(results.find(r=>!r.result.allowed)?.result.reason).toBe('bundle_budget_exceeded')
    await db.query('update book_pdf_cost_control set prior_usd=9 where document_id=$1',[f.items[0].doc])
    expect(await summary(f.items[1])).toMatchObject({allowed:false,reason:'bundle_budget_exceeded',bundle_spent_usd:9})
  })
  it('enforces two active files and eight requests across the whole bundle',async()=>{
    const f=await fixture(3);await preflight(f)
    expect((await reserve(f.items[0],30,4)).result.allowed).toBe(true)
    expect((await reserve(f.items[1],40,4)).result.allowed).toBe(true)
    expect(await summary(f.items[2])).toMatchObject({allowed:false,reason:'bundle_busy'})
    expect(await summary(f.items[0])).toMatchObject({allowed:false,reason:'bundle_busy'})
  })
  it('blocks every member when one file has settled usage with an unknown price',async()=>{
    const f=await fixture(2);await preflight(f)
    const receipt=await reserve(f.items[0],45)
    await db.query('update pdf_batch_request_cost set settled=true,actual_usd=null where batch_id=$1',[receipt.batch])
    expect(await summary(f.items[1])).toMatchObject({allowed:false,reason:'unknown_usage_cost'})
    expect((await reserve(f.items[1],46)).result).toMatchObject({allowed:false,reason:'unknown_usage_cost'})
  })
  it('caps representative work at $0.50 before provider submission',async()=>{
    const f=await fixture(1);await preflight(f)
    expect((await reserve(f.items[0],50,1,400000,21000)).result).toMatchObject({allowed:false,reason:'pilot_budget_exceeded'})
    expect((await db.query<{n:number}>('select count(*)::int n from pdf_batch_request_cost where document_id=$1',[f.items[0].doc])).rows[0].n).toBe(0)
  })
  it('does not expand a failed source/supplement or accept changed parser evidence',async()=>{
    const f=await fixture(1);await preflight(f)
    const i=f.items[0],expanded=(await db.query<{v:{allowed:boolean}}>('select book_pdf_profile_expand($1,$2) v',[i.job,i.token])).rows[0].v
    expect(expanded.allowed).toBe(false)
    const changed=(await db.query<{v:{phase:string}}>('select book_pdf_profile_plan($1,$2,$3) v',[i.job,i.token,JSON.stringify({...plan,snapshot_hash:'d'.repeat(64)})])).rows[0].v
    expect(changed.phase).toBe('held')
  })
  it('expands only after verified complete pilot units and a bounded projection',async()=>{
    const f=await fixture(1);await preflight(f);const i=f.items[0]
    const receipt=await reserve(i,60)
    await db.query(`update pdf_batch_request_cost set actual_usd=.02,settled=true where batch_id=$1`,[receipt.batch])
    await db.query(`update book_pdf_unit set verified_version=version,verification='{"status":"passed"}',enrichment='{"status":"complete"}' where document_id=$1 and unit_key='unit-1'`,[i.doc])
    const result=(await db.query<{v:{allowed:boolean}}>('select book_pdf_profile_expand($1,$2) v',[i.job,i.token])).rows[0].v
    expect(result.allowed).toBe(true)
  })
  it('stops the bundle when the same malformed-review error occurs in two files',async()=>{
    const f=await fixture(2);await preflight(f)
    for(const i of f.items)await db.query(`update book_pdf_unit set verification='{"status":"unresolved","issues":["invalid_audit_schema"]}' where document_id=$1 and unit_key='unit-1'`,[i.doc])
    for(const i of f.items)await db.query('select book_pdf_profile_expand($1,$2)',[i.job,i.token])
    expect(await summary(f.items[0])).toMatchObject({allowed:false,reason:'bundle_held'})
  })
  it('reuses a registration key without changing stopped jobs, and rejects cross-owner attachment',async()=>{
    const f=await fixture(1);await db.query("update pdf_import_job set status='failed' where id=$1",[f.items[0].job])
    expect((await db.query<{v:{ready:boolean}}>('select book_pdf_bundle_open($1,$2,$3,$4) v',[f.teacher,f.key,JSON.stringify(f.files),randomUUID()])).rows[0].v.ready).toBe(true)
    expect((await db.query<{status:string}>('select status from pdf_import_job where id=$1',[f.items[0].job])).rows[0].status).toBe('failed')
    const other=await fixture(1,false)
    await expect(db.query('select book_pdf_bundle_attach($1,$2,0,$3)',[other.bundle,other.registration,f.items[0].doc])).rejects.toThrow('foreign document')
  })
  it('keeps capacity deferrals outside the three paid-attempt limit',async()=>{
    const f=await fixture(1);await preflight(f)
    for(let n=0;n<4;n++){
      const receipt=await reserve(f.items[0],70)
      await db.query(`update book_pdf_batch set state='rejected',outcomes='{"__not_sent__":"deferred"}' where id=$1`,[receipt.batch])
      await db.query('update pdf_batch_request_cost set actual_usd=0,settled=true where batch_id=$1',[receipt.batch])
    }
  })
  it('still counts rejected requests whose submission is not proven unsent',async()=>{
    const f=await fixture(1);await preflight(f)
    for(let n=0;n<3;n++){
      const receipt=await reserve(f.items[0],80)
      await db.query(`update book_pdf_batch set state='rejected',outcomes='{}' where id=$1`,[receipt.batch])
      await db.query('update pdf_batch_request_cost set actual_usd=0,settled=true where batch_id=$1',[receipt.batch])
    }
    await expect(reserve(f.items[0],80)).rejects.toThrow()
  })
  it('restricts bundle state, request descriptors and gates to the service role',async()=>{
    for(const role of ['anon','authenticated']){
      const rows=(await db.query<{allowed:boolean}>('select has_table_privilege($1,$2,$3) allowed',[role,'public.book_pdf_bundle','select'])).rows
      expect(rows[0].allowed).toBe(false)
      expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.book_pdf_bundle_read(uuid)','execute') allowed",[role])).rows[0].allowed).toBe(false)
    }
  })
})
