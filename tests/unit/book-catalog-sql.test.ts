import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const teacher='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',bank='44444444-4444-4444-8444-444444444444'
const migration=readFileSync('supabase/migrations/20261022141950_book_registration_catalog.sql','utf8')
const profiles=readFileSync('supabase/migrations/20261029071858_book_reading_suwan_profiles.sql','utf8')
describe('book catalog metadata migration',()=>{
  let db:PGlite
  beforeAll(async()=>{
    db=new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table book_pdf_document(id uuid primary key default gen_random_uuid(),teacher_id uuid,title text,academic_year integer,source_sha256 text,
        exam_bank_id uuid,revision integer default 1,status text default 'processing',metadata_reviewed boolean default false,manifest jsonb,created_at timestamptz default now());
      create table exam_bank(id uuid primary key,teacher_id uuid,title text,exam_year integer,material_kind text);
      create table book_pdf_unit(document_id uuid,unit_key text,version integer,verified_version integer,verification jsonb,validation jsonb,extraction jsonb);
      create table exam_bank_question(id integer primary key,exam_bank_id uuid,body text);
      create table pdf_import_job(id uuid default gen_random_uuid(),teacher_id uuid,target_id uuid,status text,result jsonb,error text,attempt integer default 1);
      create table vocab_collection(id uuid primary key default gen_random_uuid(),teacher_id uuid,title text,source_document_id uuid,year_from integer,year_to integer);
      create table vocab_collection_item(collection_id uuid,sources jsonb,word text);
      grant all on all tables in schema public to service_role;
      insert into exam_bank values('${bank}','${teacher}','수능특강 영어(상) · 좌본문·우해석',2027,'textbook');
      insert into book_pdf_document(id,teacher_id,title,academic_year,source_sha256,exam_bank_id,status,manifest) values('${id}','${teacher}','수능특강 영어(상) · 좌본문·우해석',2027,repeat('a',64),'${bank}','published','{"question_count":119,"printed_years":[2027],"units":[{},{}]}');
      insert into book_pdf_unit values('${id}','unit-1',1,1,'{"status":"passed","extraction_hash":"preserve"}','{"errors":[]}','{"passage":"unchanged"}');
      insert into book_pdf_unit values('${id}','unit-2',2,1,'{"status":"passed"}','{"errors":[]}','{}');
      insert into exam_bank_question select n,'${bank}','preserve-'||n from generate_series(1,119) n;
      insert into pdf_import_job(teacher_id,target_id,status,result) values('${teacher}','${id}','succeeded','{"question_count":119}');
      insert into vocab_collection(teacher_id,title,source_document_id,year_from,year_to) values('${teacher}','수능특강 영어(상) · 좌본문·우해석 어휘','${id}',2027,2027);
      insert into vocab_collection_item select id,'[{"source":"교재","source_title":"수능특강 영어(상) · 좌본문·우해석","year":2027}]','preserve-word' from vocab_collection;
      insert into book_pdf_document(teacher_id,title) values('${teacher}','이름을 모르는 교재');`)
    await db.exec(migration);await db.exec(migration)
    const before=await db.query('select to_jsonb(d) row from book_pdf_document d order by id')
    await db.exec(profiles);await db.exec(profiles)
    expect((await db.query('select to_jsonb(d) row from book_pdf_document d order by id')).rows).toEqual(before.rows)
  },120000)
  afterAll(async()=>{await db?.close()})
  it('classifies the known published book and synchronizes labels without reparsing or changing questions/proofs/jobs',async()=>{
    expect((await db.query(`select title,book_code,volume,status from book_pdf_document where id=$1`,[id])).rows[0]).toEqual({title:'2027학년도 수능특강 영어 · 상',book_code:'suteuk_english',volume:'upper',status:'published'})
    expect((await db.query(`select count(*)::integer n from exam_bank_question where body='preserve-'||id`)).rows[0]).toEqual({n:119})
    expect((await db.query(`select verification->>'extraction_hash' hash,extraction->>'passage' passage from book_pdf_unit where unit_key='unit-1'`)).rows[0]).toEqual({hash:'preserve',passage:'unchanged'})
    expect((await db.query(`select status,attempt from pdf_import_job`)).rows).toEqual([{status:'succeeded',attempt:1}])
    expect((await db.query(`select sources->0->>'source_title' title from vocab_collection_item`)).rows[0]).toEqual({title:'2027학년도 수능특강 영어 · 상'})
    expect((await db.query(`select book_code from book_pdf_document where title='이름을 모르는 교재'`)).rows[0]).toEqual({book_code:null})
  })
  it('reuses an owned file across different registration tabs but never shares it with another teacher',async()=>{
    const args=[teacher,'a'.repeat(64),'suteuk_english',2027,'upper']
    expect((await db.query<{r:{id:string;reused:boolean}}>('select book_pdf_reserve($1,$2,$3,$4,$5) r',args)).rows[0].r).toMatchObject({id,reused:true})
    const fresh=[teacher,'b'.repeat(64),'suteuk_english',2027,'full']
    const a=(await db.query<{r:{id:string;reused:boolean}}>('select book_pdf_reserve($1,$2,$3,$4,$5) r',fresh)).rows[0].r
    const b=(await db.query<{r:{id:string;reused:boolean}}>('select book_pdf_reserve($1,$2,$3,$4,$5) r',fresh)).rows[0].r
    expect(a.reused).toBe(false);expect(b).toMatchObject({id:a.id,reused:true})
    const c=(await db.query<{r:{id:string}}>('select book_pdf_reserve($1,$2,$3,$4,$5) r',[other,...args.slice(1)])).rows[0].r
    expect(c.id).not.toBe(id)
    await expect(db.query('select book_pdf_reserve($1,$2,$3,$4,$5)',[teacher,'c'.repeat(64),'suwan_english',2027,'upper'])).rejects.toThrow('invalid book registration')
  })
  it('reserves all four verified profiles, reuses each file, and edits their classification',async()=>{
    for(const [index,[code,volume]] of [['suteuk_reading','upper'],['suteuk_reading','lower'],['suwan_english','type'],['suwan_english','practical']].entries()){
      const args=[teacher,String(index+1).repeat(64),code,2027,volume]
      const first=(await db.query<{r:{id:string;reused:boolean;volume:string}}>('select book_pdf_reserve($1,$2,$3,$4,$5) r',args)).rows[0].r
      expect(first).toMatchObject({reused:false,volume})
      expect((await db.query<{r:unknown}>('select book_pdf_reserve($1,$2,$3,$4,$5) r',args)).rows[0].r).toMatchObject({id:first.id,reused:true})
      expect((await db.query('select book_pdf_classify($1,$2,1,$3,2027,$4) ok',[first.id,teacher,code,volume])).rows[0]).toEqual({ok:true})
    }
    await expect(db.query('select book_pdf_reserve($1,$2,$3,$4,$5)',[teacher,'d'.repeat(64),'suteuk_reading',2027,'type'])).rejects.toThrow('invalid book registration')
  })
  it('edits published classification only, fences stale revisions/ownership and rejects wrong academic years',async()=>{
    const args=[id,teacher,1,'suteuk_english',2027,'lower']
    expect((await db.query('select book_pdf_classify($1,$2,$3,$4,$5,$6) ok',args)).rows[0]).toEqual({ok:true})
    expect((await db.query('select book_pdf_classify($1,$2,$3,$4,$5,$6) ok',args)).rows[0]).toEqual({ok:false})
    expect((await db.query('select book_pdf_classify($1,$2,$3,$4,$5,$6) ok',[id,other,2,...args.slice(3)])).rows[0]).toEqual({ok:false})
    await expect(db.query('select book_pdf_classify($1,$2,$3,$4,$5,$6)',[id,teacher,2,'suteuk_english',2026,'upper'])).rejects.toThrow('학년도')
    expect((await db.query('select book_code,book_volume from exam_bank where id=$1',[bank])).rows[0]).toEqual({book_code:'suteuk_english',book_volume:'lower'})
    expect((await db.query(`select count(*)::integer n from exam_bank_question`)).rows[0]).toEqual({n:119})
  })
  it('counts only current verified versions and blocks active classification edits',async()=>{
    expect((await db.query('select completed from book_pdf_progress where document_id=$1',[id])).rows[0]).toEqual({completed:1})
    await db.query(`insert into pdf_import_job(teacher_id,target_id,status) values($1,$2,'waiting_batch')`,[teacher,id])
    await expect(db.query('select book_pdf_classify($1,$2,$3,$4,$5,$6)',[id,teacher,2,'suteuk_english',2027,'upper'])).rejects.toThrow('처리 중')
    await db.query(`delete from pdf_import_job where status='waiting_batch'`)
  })
  it('clears only a metadata hold for explicit retry without dispatching or resetting attempts',async()=>{
    const held='55555555-5555-4555-8555-555555555555'
    await db.query(`insert into book_pdf_document(id,teacher_id,title,academic_year,book_code,volume,status,manifest)
      values($1,$2,'잘못된 학년도',2026,'suteuk_english','upper','review','{"printed_years":[2027],"classification_error":"학년도 불일치"}')`,[held,teacher])
    await db.query(`insert into pdf_import_job(teacher_id,target_id,status,result,attempt) values($1,$2,'failed','{"metadata_conflict":true,"verification_unresolved":true}',3)`,[teacher,held])
    expect((await db.query('select book_pdf_classify($1,$2,1,$3,2027,$4) ok',[held,teacher,'suteuk_english','upper'])).rows[0]).toEqual({ok:true})
    expect((await db.query('select status,attempt,result from pdf_import_job where target_id=$1',[held])).rows[0]).toEqual({status:'failed',attempt:3,result:null})
    expect((await db.query("select status,manifest->>'classification_error' error,manifest->'printed_years' years from book_pdf_document where id=$1",[held])).rows[0]).toEqual({status:'processing',error:null,years:[2027]})
  })
  it('restricts mutation RPCs to the service role',async()=>{
    await db.exec('set role authenticated')
    try{await expect(db.query('select book_pdf_classify($1,$2,$3,$4,$5,$6)',[id,teacher,2,'suteuk_english',2027,'upper'])).rejects.toThrow('permission denied')}
    finally{await db.exec('reset role')}
  })
  it('uses invoker security for progress so another teacher cannot see counts',async()=>{
    await db.exec(`alter table book_pdf_document enable row level security;alter table book_pdf_unit enable row level security;
      grant select on book_pdf_document,book_pdf_unit to authenticated;
      create policy doc_owner on book_pdf_document to authenticated using(teacher_id=current_setting('request.teacher_id',true)::uuid);
      create policy unit_owner on book_pdf_unit to authenticated using(document_id in(select id from book_pdf_document));
      set request.teacher_id='${other}';set role authenticated;`)
    try{expect((await db.query('select * from book_pdf_progress')).rows).toEqual([])}finally{await db.exec('reset role')}
    await db.exec(`set request.teacher_id='${teacher}';set role authenticated;`)
    try{expect((await db.query('select completed from book_pdf_progress')).rows).toEqual([{completed:1}])}finally{await db.exec('reset role')}
  })
})
