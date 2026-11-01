import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { claudeTokenCost } from '@/lib/costs/estimate'

describe('per-request Haiku Batch accounting SQL', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table cost_usage_event(provider text,feature text,model text,units numeric default 1,input_tokens bigint default 0,output_tokens bigint default 0,cache_read_tokens bigint default 0,cache_write_tokens bigint default 0,service_tier text default 'batch',environment text default 'test',occurred_at timestamptz default now());`)
    const sql = readFileSync('supabase/migrations/20261101114827_book_haiku55_batch_pricing.sql', 'utf8')
    await db.exec(sql); await db.exec(sql)
  },120000)
  afterAll(async () => { await db?.close() })
  it('matches reservations/actual prices at both prompt tiers including cached input', async () => {
    for (const [i,o,r,w] of [[100000,1000,0,0],[100001,1000,0,0],[60000,500,30000,10000],[60000,500,30001,10000],[0,0,0,0]]) {
      const usage={inputTokens:i,outputTokens:o,cacheReadTokens:r,cacheWriteTokens:w}
      const result=(await db.query<{v:string}>('select pdf_batch_token_cost($1,$2) v',['claude-haiku-5-5-20261007',JSON.stringify(usage)])).rows[0].v
      expect(Number(result)).toBeCloseTo(claudeTokenCost('claude-haiku-5-5',{input:i,output:o,read:r,write:w},{tier:'batch'})!,10)
    }
    expect((await db.query<{v:null}>('select pdf_batch_token_cost($1,$2) v',['unknown',JSON.stringify({inputTokens:1,outputTokens:1,cacheReadTokens:0,cacheWriteTokens:0})])).rows[0].v).toBeNull()
    expect((await db.query<{v:null}>(`select pdf_batch_token_cost('claude-haiku-5-5','{}') v`)).rows[0].v).toBeNull()
  })
  it('sums individually priced requests rather than promoting a monthly group into the long tier', async () => {
    await db.exec(`insert into cost_usage_event(provider,feature,model,input_tokens,output_tokens) values
      ('claude','book.mapSource','claude-haiku-5-5',60000,1000),('claude','book.mapSource','claude-haiku-5-5',60000,1000),('claude','book.mapSource','claude-haiku-5-5',120000,1000);`)
    const result=(await db.query<{calls:number;input_tokens:string;estimated_usd:string}>(`select * from cost_usage_summary(now()-interval '1 day',now()+interval '1 day','test')`)).rows[0]
    expect(Number(result.calls)).toBe(3);expect(Number(result.input_tokens)).toBe(240000)
    expect(Number(result.estimated_usd)).toBeCloseTo(0.03775)
    await db.exec(`insert into cost_usage_event(provider,feature,model,input_tokens,output_tokens,service_tier) values('claude','standard','claude-haiku-5-5',60000,1000,'standard')`)
    const standard=(await db.query<{estimated_usd:string}>(`select estimated_usd from cost_usage_summary(now()-interval '1 day',now()+interval '1 day','test') where feature='standard'`)).rows[0]
    expect(Number(standard.estimated_usd)).toBeCloseTo(0.0065)
  })
  it('keeps budget/old-model prices and public permissions unchanged', async () => {
    expect(Number((await db.query<{v:string}>(`select pdf_batch_token_cost('claude-sonnet-5-5','{"inputTokens":1000,"outputTokens":100,"cacheReadTokens":0,"cacheWriteTokens":0}') v`)).rows[0].v)).toBeCloseTo(0.0015)
    await db.exec('set role authenticated')
    try { await expect(db.query(`select pdf_batch_token_cost('claude-haiku-5-5','{}')`)).rejects.toThrow('permission denied') }
    finally { await db.exec('reset role') }
  })
})
