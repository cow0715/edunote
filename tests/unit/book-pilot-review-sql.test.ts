import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { KNOWN_SOURCE_POLICIES, KNOWN_SOURCE_REVISION } from '@/lib/book-pdf/known-source-policy'

describe('passive textbook pilot review gates', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table pdf_import_job(id uuid primary key,teacher_id uuid,kind text,target_id uuid,payload jsonb default '{}',result jsonb,status text,stage text,lease_token uuid,lease_expires_at timestamptz,attempt int default 0,error text,updated_at timestamptz default now(),created_at timestamptz default now());
      create table book_pdf_document(id uuid primary key,teacher_id uuid,exam_bank_id uuid,manifest jsonb,status text default 'processing',title text default 'fixture',source_sha256 text);
      create table book_pdf_unit(document_id uuid,unit_key text,version int default 1,verified_version int,verification jsonb,enrichment jsonb,primary key(document_id,unit_key));
      create table exam_bank(id uuid primary key,teacher_id uuid);
      create table pdf_import_checkpoint(job_id uuid,call_key text,value jsonb,created_at timestamptz default now(),primary key(job_id,call_key));
      grant all on pdf_import_job,book_pdf_document,book_pdf_unit,exam_bank,pdf_import_checkpoint to service_role;`)
    for (const name of ['20261021150000_book_pdf_batches.sql','20261023113525_exam_bank_batch_imports.sql','20261021000001_cost_management.sql','20261029113902_book_pdf_cost_controls.sql','20261030115616_book_import_bundles.sql',
      '20261101121520_book_source_pilot_review.sql','20261101121520_book_source_pilot_review.sql']) await db.exec(readFileSync('supabase/migrations/'+name,'utf8'))
  }, 120000)
  afterAll(async () => { await db?.close() })
  async function fixture() {
    const teacher=randomUUID(),registration=randomUUID(),job=randomUUID(),doc=randomUUID(),token=randomUUID()
    const bundle=(await db.query<{v:{id:string}}>('select book_pdf_bundle_open($1,$2,$3,$4) v',[teacher,randomUUID(),JSON.stringify([{fileName:'fixture.pdf'}]),registration])).rows[0].v.id
    await db.query('insert into book_pdf_document(id,teacher_id,source_sha256) values($1,$2,$3)',[doc,teacher,'b'.repeat(64)])
    await db.query(`insert into pdf_import_job(id,teacher_id,target_id,kind,status,lease_token,lease_expires_at) values($1,$2,$3,'bank_book','running',$4,now()+interval '1 hour')`,[job,teacher,doc,token])
    await db.query('select book_pdf_bundle_attach($1,$2,0,$3,$4)',[bundle,registration,doc,job])
    await db.query('select book_pdf_bundle_seal($1,$2)',[bundle,registration])
    await db.query(`insert into book_pdf_unit(document_id,unit_key) values($1,'unit-1'),($1,'unit-2')`,[doc])
    const plan={version:'jugis-two-column-v1',snapshot_hash:'a'.repeat(64),pdf_hash:'b'.repeat(64),unit_count:2,question_count:2,pilot_keys:['unit-1'],pilot_labels:{'unit-1':['대표 문제']},ambiguous_units:[]}
    await db.query('select book_pdf_profile_plan($1,$2,$3)',[job,token,JSON.stringify(plan)])
    await db.query('select book_pdf_cost_summary($1,$2)',[job,token])
    await db.query(`update book_pdf_unit set verified_version=version,verification='{"status":"passed"}',enrichment='{"status":"complete"}' where document_id=$1 and unit_key='unit-1'`,[doc])
    return {teacher,job,doc,token,bundle}
  }
  async function pause(f:Awaited<ReturnType<typeof fixture>>) { return (await db.query<{v:{ready:boolean;review:{snapshot:string;spent_usd:number;remaining_units:number}}}>('select book_pdf_profile_pause($1,$2) v',[f.job,f.token])).rows[0].v }
  async function approve(f:Awaited<ReturnType<typeof fixture>>, snapshot:string, confirm:boolean|null=true) { return db.query<{v:{approved:boolean;resumed:boolean}}>('select book_pdf_pilot_approve($1,$2,$3,$4) v',[f.doc,f.teacher,snapshot,confirm]) }
  it('pauses a fully cached pilot, reports spend, and cannot auto-expand',async()=>{
    const f=await fixture(),p=await pause(f)
    expect(p).toMatchObject({ready:true,review:{spent_usd:0,remaining_units:1}})
    expect((await db.query<{phase:string}>('select phase from book_pdf_bundle_file where document_id=$1',[f.doc])).rows[0].phase).toBe('pilot_review')
    expect((await db.query<{v:{allowed:boolean;reason:string}}>('select book_pdf_cost_summary($1,$2) v',[f.job,f.token])).rows[0].v).toMatchObject({allowed:false,reason:'pilot_review_required'})
    await expect(db.query(`update book_pdf_bundle_file set phase='bulk' where document_id=$1`,[f.doc])).rejects.toThrow('explicit pilot approval required')
  })
  it('approval stores consent only, never queues/resumes a worker or changes the cap',async()=>{
    const f=await fixture(),p=await pause(f)
    await db.query(`update pdf_import_job set status='failed',result='{"pilot_review_required":true}' where id=$1`,[f.job])
    expect((await approve(f,p.review.snapshot)).rows[0].v).toEqual({approved:true,resumed:false})
    expect((await db.query<{status:string;cap:string;phase:string}>(`select j.status,c.limit_usd::text cap,f.phase from pdf_import_job j join book_pdf_cost_control c on c.document_id=j.target_id join book_pdf_bundle_file f on f.document_id=j.target_id where j.id=$1`,[f.job])).rows[0]).toEqual({status:'failed',cap:'5.000000',phase:'bulk'})
  })
  it('rejects missing consent, cross-owner approval, stale evidence and exhausted budget',async()=>{
    const f=await fixture(),p=await pause(f)
    await db.query(`update pdf_import_job set status='failed' where id=$1`,[f.job])
    await expect(approve(f,p.review.snapshot,null)).rejects.toThrow('snapshot changed')
    await expect(approve({...f,teacher:randomUUID()},p.review.snapshot)).rejects.toThrow('stopped owned job')
    await db.query(`update book_pdf_unit set version=version+1 where document_id=$1 and unit_key='unit-1'`,[f.doc])
    await expect(approve(f,p.review.snapshot)).rejects.toThrow('snapshot changed')
    const g=await fixture();await db.query('update book_pdf_cost_control set prior_usd=5 where document_id=$1',[g.doc]);const q=await pause(g)
    await db.query(`update pdf_import_job set status='failed' where id=$1`,[g.job])
    await expect(approve(g,q.review.snapshot)).rejects.toThrow('file budget exhausted')
  })
  it('does not treat incomplete supplements or a known bad cache as a valid pilot',async()=>{
    const f=await fixture(),known=KNOWN_SOURCE_POLICIES[0]
    await db.query('update book_pdf_unit set verification=$2 where document_id=$1 and unit_key=\'unit-1\'',[f.doc,JSON.stringify({status:'passed',pdf_hash:known.pdfHash,source_hash:known.sourceHash})])
    expect((await pause(f)).ready).toBe(false)
    await expect(db.query(`update book_pdf_document set status='published' where id=$1`,[f.doc])).rejects.toThrow('fresh image audit')
    await db.query('update book_pdf_unit set verification=verification||$2::jsonb where document_id=$1',[f.doc,JSON.stringify({source_revision:KNOWN_SOURCE_REVISION})])
    expect((await db.query<{ready:boolean}>('select book_pdf_pilot_ready($1) ready',[f.doc])).rows[0].ready).toBe(true)
    await db.query('update book_pdf_unit set enrichment=null where document_id=$1',[f.doc])
    expect((await db.query<{ready:boolean}>('select book_pdf_pilot_ready($1) ready',[f.doc])).rows[0].ready).toBe(false)
  })
  it('blocks lower-volume excluded job wakeups and replacement jobs without deleting data',async()=>{
    const f=await fixture()
    await db.query(`update pdf_import_job set status='failed',payload='{"recoveryExcluded":true}' where id=$1`,[f.job])
    await expect(db.query(`update pdf_import_job set status='queued' where id=$1`,[f.job])).rejects.toThrow('excluded')
    await expect(db.query(`insert into pdf_import_job(id,teacher_id,target_id,kind,status) values($1,$2,$3,'bank_book','queued')`,[randomUUID(),f.teacher,f.doc])).rejects.toThrow('excluded')
    expect((await db.query<{n:number}>('select count(*)::int n from book_pdf_unit where document_id=$1',[f.doc])).rows[0].n).toBe(2)
  })
  it('permits only the service role to access pilot RPCs',async()=>{
    for(const role of ['anon','authenticated'])expect((await db.query<{allowed:boolean}>("select has_function_privilege($1,'book_pdf_pilot_approve(uuid,uuid,text,boolean)','execute') allowed",[role])).rows[0].allowed).toBe(false)
  })
})
