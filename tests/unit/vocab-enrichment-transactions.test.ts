import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { sql } from 'drizzle-orm'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { saveExampleBatch,saveVariantBatch,type ExampleInput,type VariantInput } from '@/lib/services/vocab-enrichment'
vi.mock('server-only',()=>({}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const teacher=id(1),user=id(11),week=id(31),word=id(41),word2=id(42),variant=id(51),variant2=id(52)
const result=(key=word)=>({id:key,sentence:'A valid sentence.',translation:'예문입니다.',distractor:null})
const patch=(key=variant)=>({id:key,part_of_speech:'n.',meaning:'보강 뜻',usage_note:null,excluded_meanings:[],needs_review:false,confidence:0.9})
const migration='supabase/migrations/20261023130734_vocab_enrichment_transactions.sql'
describe('vocabulary enrichment PostgreSQL persistence under RLS',()=>{
  let db:PGlite
  let orm:ReturnType<typeof drizzle>
  beforeAll(async()=>{
    db=new PGlite()
    for(const file of ['tests/fixtures/transaction-schema.sql','tests/fixtures/compound-transaction-schema.sql',
      'supabase/migrations/20260929101449_server_transaction_role.sql','supabase/migrations/20261019000002_expand_transaction_writes.sql',
      'supabase/migrations/20260510000001_add_vocab_variant_cache.sql','supabase/migrations/20260510000002_use_word_pos_vocab_variant_cache.sql',migration])
      await db.exec(readFileSync(file,'utf8'))
    await db.exec(`alter table week add column if not exists vocab_examples_generated_at timestamptz;
      insert into week(id,class_id,week_number) values('${week}','${id(21)}',1),('${id(32)}','${id(22)}',1);
      insert into vocab_word(id,week_id,number,english_word,correct_answer) values('${word}','${week}',1,'alpha','원래 뜻'),('${word2}','${week}',2,'beta','다른 뜻');
      insert into vocab_word_variant(id,vocab_word_id,word,relation_type) values('${variant}','${word}','alpha-derived','derivative'),('${variant2}','${word2}','beta-derived','derivative');`)
    orm=drizzle(db)
  },30_000)
  afterAll(async()=>{await db?.close()})
  const run=<T>(work:(c:TeacherTransaction)=>Promise<T>)=>orm.transaction(async tx=>{
    await tx.execute(sql`set local role edunote_app`)
    await tx.execute(sql`select set_config('request.jwt.claims',${JSON.stringify({sub:user})},true)`)
    return work({tx:tx as unknown as TeacherTransaction['tx'],teacherId:teacher})
  })
  const examples=async()=>(await db.query<ExampleInput>(`select id,english_word,example_sentence,example_translation,example_distractor,example_source from vocab_word order by id`)).rows
  const variants=async()=>(await db.query<VariantInput>(`select jsonb_build_object('id',v.id,'vocab_word_id',v.vocab_word_id,'word',v.word,'part_of_speech',v.part_of_speech,'meaning',v.meaning,'relation_type',v.relation_type,'usage_note',v.usage_note,'raw_text',v.raw_text,'needs_review',v.needs_review,'excluded_meanings',v.excluded_meanings,'confidence',v.confidence) as variant,
    jsonb_build_object('id',w.id,'english_word',w.english_word,'correct_answer',w.correct_answer) as source
    from vocab_word_variant v join vocab_word w on w.id=v.vocab_word_id order by v.id`)).rows
  const clear=()=>db.exec(`delete from vocab_variant_cache;update vocab_word_variant set meaning=null,part_of_speech=null,needs_review=false,usage_note=null,excluded_meanings='{}',confidence=null;
    update vocab_word set example_sentence=null,example_translation=null,example_distractor=null,example_source=null;update week set vocab_examples_generated_at=null;`)
  it('rolls back the complete example batch and generation marker on a late row failure',async()=>{
    await db.exec(`create function fail_example() returns trigger language plpgsql as $$begin if new.id='${word2}' then raise exception 'injected';end if;return new;end$$;
      create trigger fail_example before update on vocab_word for each row execute function fail_example();`)
    const before=await examples()
    await expect(run(c=>saveExampleBatch(c,week,before,[result(),result(word2)]))).rejects.toThrow()
    expect(await examples()).toEqual(before)
    expect((await db.query('select vocab_examples_generated_at from week where id=$1',[week])).rows).toEqual([{vocab_examples_generated_at:null}])
    await db.exec('drop trigger fail_example on vocab_word')
  })
  it('saves examples and marker together while preserving filled examples and rejecting stale input',async()=>{
    const before=await examples()
    expect(await run(c=>saveExampleBatch(c,week,before,[result()]))).toBe(1)
    expect((await examples())[0].example_sentence).toBe('A valid sentence.')
    expect((await db.query('select vocab_examples_generated_at from week where id=$1',[week])).rows[0]).not.toEqual({vocab_examples_generated_at:null})
    await expect(run(c=>saveExampleBatch(c,week,before,[result()]))).rejects.toMatchObject({status:409})
    await db.exec(`update vocab_word set english_word='edited' where id='${word2}'`)
    await expect(run(c=>saveExampleBatch(c,week,before,[result(word2)]))).rejects.toMatchObject({status:409})
    await db.exec(`update vocab_word set english_word='beta' where id='${word2}'`)
    await clear()
  })
  it('rejects unexpected/duplicate example output and other teacher weeks',async()=>{
    const before=await examples()
    await expect(run(c=>saveExampleBatch(c,week,before,[result(id(99))]))).rejects.toMatchObject({status:400})
    await expect(run(c=>saveExampleBatch(c,week,before,[result(),result()]))).rejects.toMatchObject({status:400})
    await expect(run(c=>saveExampleBatch(c,id(32),before,[result()]))).rejects.toMatchObject({status:403})
    expect((await examples())[0].example_sentence).toBeNull()
  })
  it('rolls back variant changes when dictionary saving fails',async()=>{
    await db.exec(`create function fail_cache() returns trigger language plpgsql as $$begin raise exception 'injected';end$$;
      create trigger fail_cache before insert on vocab_variant_cache for each row execute function fail_cache();`)
    const before=await variants()
    await expect(run(c=>saveVariantBatch(c,week,before,[patch(),patch(variant2)],[variant,variant2]))).rejects.toThrow()
    expect(await variants()).toEqual(before)
    expect((await db.query('select * from vocab_variant_cache')).rows).toHaveLength(0)
    await db.exec('drop trigger fail_cache on vocab_variant_cache')
  })
  it('commits variant meanings and cache together and preserves source identity',async()=>{
    const before=await variants()
    await run(c=>saveVariantBatch(c,week,before,[patch(),patch(variant2)],[variant,variant2]))
    expect((await variants()).every(row=>row.variant.meaning==='보강 뜻')).toBe(true)
    expect((await db.query('select word_key,word from vocab_variant_cache order by word_key')).rows).toEqual([
      {word_key:'alpha-derived',word:'alpha-derived'},{word_key:'beta-derived',word:'beta-derived'}])
    await clear()
  })
  it('rejects stale source meanings or manual variant edits without writing any result',async()=>{
    const before=await variants()
    await db.exec(`update vocab_word set correct_answer='teacher edit' where id='${word}'`)
    await expect(run(c=>saveVariantBatch(c,week,before,[patch(),patch(variant2)],[variant,variant2]))).rejects.toMatchObject({status:409})
    await db.exec(`update vocab_word set correct_answer='원래 뜻' where id='${word}';update vocab_word_variant set meaning='manual' where id='${variant}'`)
    await expect(run(c=>saveVariantBatch(c,week,before,[patch(),patch(variant2)],[variant,variant2]))).rejects.toMatchObject({status:409})
    expect((await db.query('select * from vocab_variant_cache')).rows).toHaveLength(0)
    expect((await variants())[1].variant.meaning).toBeNull()
    await clear()
  })
  it('rolls back earlier variant changes on a later variant failure',async()=>{
    await db.exec(`create function fail_variant() returns trigger language plpgsql as $$begin if new.id='${variant2}' then raise exception 'injected';end if;return new;end$$;
      create trigger fail_variant before update on vocab_word_variant for each row execute function fail_variant();`)
    const before=await variants()
    await expect(run(c=>saveVariantBatch(c,week,before,[patch(),patch(variant2)],[variant,variant2]))).rejects.toThrow()
    expect(await variants()).toEqual(before)
    await db.exec('drop trigger fail_variant on vocab_word_variant')
  })
  it('cache-only fills variants without changing the shared cache',async()=>{
    const before=await variants()
    await run(c=>saveVariantBatch(c,week,before,[patch()],[]))
    expect((await variants())[0].variant.meaning).toBe('보강 뜻')
    expect((await db.query('select * from vocab_variant_cache')).rows).toHaveLength(0)
    await clear()
  })
  it('supports the legacy dictionary conflict target inside a savepoint',async()=>{
    await db.exec('drop index idx_vocab_variant_cache_word_pos_unique')
    const before=await variants()
    await run(c=>saveVariantBatch(c,week,before,[patch()],[variant]))
    expect((await db.query('select * from vocab_variant_cache')).rows).toHaveLength(1)
    await clear()
    await db.exec('create unique index idx_vocab_variant_cache_word_pos_unique on vocab_variant_cache(word_key,part_of_speech_key)')
  })
  it('rejects foreign weeks and unexpected variant output, and keeps cache inaccessible without an approved teacher',async()=>{
    const before=await variants()
    await expect(run(c=>saveVariantBatch(c,id(32),before,[patch()],[variant]))).rejects.toMatchObject({status:403})
    await expect(run(c=>saveVariantBatch(c,week,before,[patch(id(99))],[id(99)]))).rejects.toMatchObject({status:400})
    await db.exec(`insert into teacher(id,auth_id,approval_status) values('${id(3)}','${id(13)}','pending')`)
    await expect(orm.transaction(async tx=>{
      await tx.execute(sql`set local role edunote_app`)
      await tx.execute(sql`select set_config('request.jwt.claims',${JSON.stringify({sub:id(13)})},true)`)
      await tx.execute(sql`insert into vocab_variant_cache(word_key,word,relation_type,meaning) values('forged','forged','original','forged')`)
    })).rejects.toThrow()
    await db.exec(readFileSync(migration,'utf8'))
    expect((await db.query("select has_table_privilege('edunote_app','vocab_variant_cache','DELETE') as allowed")).rows).toEqual([{allowed:false}])
  })
})
