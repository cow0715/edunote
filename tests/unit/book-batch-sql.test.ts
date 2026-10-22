import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const id='11111111-1111-4111-8111-111111111111', teacher='22222222-2222-4222-8222-222222222222',
  token='33333333-3333-4333-8333-333333333333', other='44444444-4444-4444-8444-444444444444'
const key='a'.repeat(64), meta=JSON.stringify([{ key,task:'book.mapSource',model:'claude-sonnet-5-5' }])
describe('textbook batch lease and submission SQL', () => {
  let db:PGlite
  beforeAll(async () => {
    db=new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.pdf_import_job(id uuid primary key,teacher_id uuid,kind text,target_id uuid,payload jsonb default '{}',
        status text check(status in ('queued','running','succeeded','failed')),stage text,lease_token uuid,lease_expires_at timestamptz,
        attempt integer default 0,error text,updated_at timestamptz default now());
      create table public.exam_bank(id uuid primary key,teacher_id uuid);
      create table public.book_pdf_document(id uuid primary key,exam_bank_id uuid,teacher_id uuid);
      grant all on public.pdf_import_job,public.exam_bank,public.book_pdf_document to service_role;`)
    await db.exec(readFileSync('supabase/migrations/20261021150000_book_pdf_batches.sql','utf8'))
    await db.exec(readFileSync('supabase/migrations/20261021150000_book_pdf_batches.sql','utf8'))
    await db.query(`insert into public.pdf_import_job(id,teacher_id,kind,target_id,status) values($1,$2,'bank_book',$3,'queued')`,[id,teacher,other])
  },120000)
  afterAll(async () => { await db?.close() })

  it('suspends a textbook and lets a future execution claim the same durable job',async()=>{
    await db.query('select * from public.pdf_import_claim($1,$2)',[id,token])
    expect((await db.query<{ok:boolean}>('select public.pdf_import_suspend_batch($1,$2,now()+interval \'5 minutes\') as ok',[id,token])).rows[0].ok).toBe(true)
    expect((await db.query<{status:string;lease_token:null}>('select status,lease_token from public.pdf_import_job where id=$1',[id])).rows[0]).toEqual({status:'waiting_batch',lease_token:null})
    // A duplicate/old wake must not create another chain of five-minute polls.
    expect((await db.query('select * from public.pdf_import_claim($1,$2)',[id,token])).rows).toHaveLength(0)
    await db.query('update public.pdf_import_job set resume_after=now()-interval \'1 second\' where id=$1',[id])
    expect((await db.query('select * from public.pdf_import_claim($1,$2)',[id,token])).rows).toHaveLength(1)
  })
  it('fences stale workers, blocks duplicate active requests, and keeps the three-submission budget',async()=>{
    await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)',[id,other,meta])).rejects.toThrow('lease lost')
    for(let n=0;n<3;n++){
      const batch=(await db.query<{id:string}>('select * from public.book_pdf_batch_prepare($1,$2,$3)',[id,token,meta])).rows[0]
      await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)',[id,token,meta])).rejects.toThrow()
      await db.query('select public.book_pdf_batch_update($1,$2,$3,\'rejected\',null,\'{}\')',[id,token,batch.id])
    }
    await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)',[id,token,meta])).rejects.toThrow('attempt limit')
  })
  it('prevents a second active import while a textbook is waiting and blocks exam deletion',async()=>{
    await db.query('select public.pdf_import_suspend_batch($1,$2,now())',[id,token])
    await expect(db.query(`insert into public.pdf_import_job(id,teacher_id,kind,target_id,status) values(gen_random_uuid(),$1,'bank_book',$2,'queued')`,[teacher,other])).rejects.toThrow('pdf_import_active_target')
    await db.query('insert into public.exam_bank(id,teacher_id) values($1,$2)',[other,teacher])
    await expect(db.query('select public.pdf_import_delete_exam($1,$2)',[other,teacher])).rejects.toThrow('PDF import is active')
  })
  it('does not grant authenticated callers access to batch metadata or submission functions',async()=>{
    await db.exec('set role authenticated')
    try {
      await expect(db.query('select * from public.book_pdf_batch')).rejects.toThrow('permission denied')
      await expect(db.query('select * from public.book_pdf_batch_prepare($1,$2,$3)',[id,token,meta])).rejects.toThrow('permission denied')
    } finally { await db.exec('reset role') }
  })
  it('leaves past-exam claims working and disallows suspending them as textbook batches',async()=>{
    const exam='55555555-5555-4555-8555-555555555555'
    await db.query(`insert into public.pdf_import_job(id,teacher_id,kind,target_id,status) values($1,$2,'bank_questions',gen_random_uuid(),'queued')`,[exam,teacher])
    expect((await db.query('select * from public.pdf_import_claim($1,$2)',[exam,token])).rows).toHaveLength(1)
    expect((await db.query<{ok:boolean}>('select public.pdf_import_suspend_batch($1,$2,now()) as ok',[exam,token])).rows[0].ok).toBe(false)
  })
})
