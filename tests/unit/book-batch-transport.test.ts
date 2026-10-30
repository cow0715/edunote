import { describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BatchCreateParams, MessageBatch, MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches'
import { BookBatchTransport, type BookBatchProvider } from '@/lib/book-pdf/batch-transport'
import { BookBatchPending, BookBatchRequestFailed, BookBatchStopped } from '@/lib/book-pdf/batch-policy'
import { createLlmExecution } from '@/lib/llm/client'
import type { CallLlmOptions } from '@/lib/llm/types'
import type { PdfImportJob } from '@/lib/pdf-import/types'
import type { PdfWorkerContext } from '@/lib/pdf-import/context'
import { BOOK_PROFILE_VERSION } from '@/lib/book-pdf/profiles'
import { PdfBundleDeferred } from '@/lib/pdf-import/batch-policy'

const key = 'a'.repeat(64)
function fixture(kind: PdfImportJob['kind'] = 'bank_book') {
  const rows: { id: string; state: string; provider_id: string | null; requests: { key: string }[]; created_at: string }[] = []
  const saved = new Map<string, unknown>()
  const db = { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: structuredClone(rows), error: null }) }) }) }),
    rpc: vi.fn(async (name, args): Promise<{ data?: unknown; error: null }> => {
      if (name === 'book_pdf_cost_summary' || name === 'book_pdf_cost_reserve') return { data: { allowed: true, reason: null, limit_usd: 5, spent_usd: 0, reserved_usd: 0, call_limit: 1000, calls_used: 0 }, error: null }
      if (name === 'pdf_batch_record_usage') return { error: null }
      if (name === 'book_pdf_batch_prepare') {
        const row = { id: `row-${rows.length}`, state: 'submitting', provider_id: null, requests: args.p_requests, created_at: new Date().toISOString() }
        rows.push(row); return { data: [structuredClone(row)], error: null }
      }
      Object.assign(rows.find((r) => r.id === args.p_batch)!, { state: args.p_state, provider_id: args.p_provider })
      return { error: null }
    }) }
  const provider = { countTokens: vi.fn(async () => 100), create: vi.fn(async (requests: BatchCreateParams.Request[]) => ({ id: `msgbatch_${rows.length}`, request_counts: { processing: requests.length } } as MessageBatch)),
    retrieve: vi.fn(async () => ({ processing_status: 'ended' } as MessageBatch)),
    results: vi.fn(async () => (async function* () { yield success() })()) }
  const context: PdfWorkerContext = { unitKey: 'unit-1', signal: new AbortController().signal, concurrency: 2, execute: (call) => call(),
    stage: async () => {}, read: async <T>(k: string) => saved.get(k) as T ?? null,
    write: async (k, v) => { if (!saved.has(k)) saved.set(k, v) } }
  const job = { id: 'job', kind, lease_token: 'lease', payload: {} } as PdfImportJob
  const broker = () => new BookBatchTransport(db as unknown as SupabaseClient, job, context, provider as BookBatchProvider)
  const options: CallLlmOptions = { task: 'book.mapSource', maxTokens: 12000, content: 'test source', execution: createLlmExecution() }
  return { rows, saved, db, provider, context, broker, options, job }
}
function success(stop = 'end_turn'): MessageBatchIndividualResponse {
  return { custom_id: key, result: { type: 'succeeded', message: { content: [{ type: 'text', text: '{"groups":[]}' }],
    stop_reason: stop, model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 5 } } } } as MessageBatchIndividualResponse
}
const responseStream = (responses: MessageBatchIndividualResponse[]) => (async function* () { for (const r of responses) yield r })()

describe('durable textbook Batch API transport', () => {
  it('limits format-profile collection to four requests while leaving the legacy window intact',async()=>{
    const f=fixture();f.job.payload.bookProfile=BOOK_PROFILE_VERSION
    const broker=f.broker();await broker.poll()
    for(let n=0;n<6;n++)await expect(broker.call({...f.options,content:`unit ${n}`},n.toString(16).padStart(64,'b'))).rejects.toBeInstanceOf(BookBatchPending)
    expect(f.context.canPrepareUnit?.('unit-2')).toBe(false)
    await broker.submit()
    expect(f.provider.create.mock.calls[0][0]).toHaveLength(4)
  })
  it('defers a bundle capacity barrier without counting tokens or contacting the provider',async()=>{
    const f=fixture(),broker=f.broker();await broker.poll()
    await expect(broker.call(f.options,key)).rejects.toBeInstanceOf(BookBatchPending)
    f.db.rpc.mockImplementationOnce(async()=>({data:{allowed:false,reason:'bundle_preparing'},error:null}))
    await expect(broker.submit()).rejects.toBeInstanceOf(PdfBundleDeferred)
    expect(f.provider.countTokens).not.toHaveBeenCalled();expect(f.provider.create).not.toHaveBeenCalled()
  })
  it('blocks a file call ceiling before token counting or provider submission', async () => {
    const f=fixture(), broker=f.broker(); await broker.poll()
    await expect(broker.call(f.options,key)).rejects.toBeInstanceOf(BookBatchPending)
    f.db.rpc.mockImplementationOnce(async()=>({data:{allowed:true,reason:null,limit_usd:5,spent_usd:0,reserved_usd:0,call_limit:1,calls_used:1},error:null}))
    await expect(broker.submit()).rejects.toThrow('누적 AI 호출 상한')
    expect(f.provider.countTokens).not.toHaveBeenCalled(); expect(f.provider.create).not.toHaveBeenCalled()
  })
  it('fails closed when the server does not expose a durable call ceiling', async () => {
    const f=fixture(), broker=f.broker(); await broker.poll()
    await expect(broker.call(f.options,key)).rejects.toBeInstanceOf(BookBatchPending)
    f.db.rpc.mockImplementationOnce(async()=>({data:{allowed:true,reason:null,limit_usd:5,spent_usd:0,reserved_usd:0},error:null}))
    await expect(broker.submit()).rejects.toThrow('누적 호출 상한 SQL')
    expect(f.provider.countTokens).not.toHaveBeenCalled(); expect(f.provider.create).not.toHaveBeenCalled()
  })
  it('does not submit if a concurrent claim consumes the last server call slot', async () => {
    const f=fixture(), broker=f.broker(); await broker.poll()
    await expect(broker.call(f.options,key)).rejects.toBeInstanceOf(BookBatchPending)
    const original=f.db.rpc.getMockImplementation()!
    f.db.rpc.mockImplementation(async(name,args)=> name === 'book_pdf_batch_prepare'
      ? { data: null, error: { message: 'file cumulative call limit exceeded' } } as never : original(name,args))
    await expect(broker.submit()).rejects.toBeInstanceOf(BookBatchStopped)
    expect(f.provider.create).not.toHaveBeenCalled()
  })
  it('blocks an over-budget file before counting or sending any new request', async () => {
    const f=fixture(),broker=f.broker();await broker.poll()
    await expect(broker.call(f.options,key)).rejects.toBeInstanceOf(BookBatchPending)
    f.db.rpc.mockImplementationOnce(async()=>({data:{allowed:false,reason:'file_budget_exceeded',limit_usd:5,spent_usd:9,reserved_usd:0},error:null}))
    await expect(broker.submit()).rejects.toThrow('파일 총예산')
    expect(f.provider.countTokens).not.toHaveBeenCalled();expect(f.provider.create).not.toHaveBeenCalled()
  })
  it('reserves the entire request before generation and stops if another reservation spent the available budget',async()=>{
    const f=fixture(),broker=f.broker();await broker.poll()
    await expect(broker.call(f.options,key)).rejects.toBeInstanceOf(BookBatchPending)
    const original=f.db.rpc.getMockImplementation()!
    f.db.rpc.mockImplementation(async(name,args)=>name==='book_pdf_cost_reserve'
      ?{data:{allowed:false,reason:'file_budget_exceeded',limit_usd:5,spent_usd:4.99,reserved_usd:0},error:null}:original(name,args))
    await expect(broker.submit()).rejects.toThrow('파일 총예산')
    expect(f.provider.countTokens).toHaveBeenCalledOnce();expect(f.provider.create).not.toHaveBeenCalled()
    expect(f.rows[0].state).toBe('rejected')
  })
  it('limits the first textbook batch to ten requests',async()=>{
    const f=fixture(),broker=f.broker();await broker.poll()
    for(let n=0;n<12;n++)await expect(broker.call({...f.options,content:`unit ${n}`},n.toString(16).padStart(64,'b'))).rejects.toBeInstanceOf(BookBatchPending)
    expect(f.context.canPrepareUnit?.('unit-2')).toBe(false)
    expect(f.context.canPrepareUnit?.('unit-1')).toBe(true)
    await broker.submit()
    expect(f.provider.create.mock.calls[0][0]).toHaveLength(10)
    expect(f.provider.countTokens).toHaveBeenCalledTimes(10)
  })
  it('reads existing deliveries in cache-only mode but never submits missing or previously collected requests', async () => {
    const f = fixture(), broker = f.broker()
    await broker.poll()
    await expect(broker.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending)
    f.context.cacheOnly = true
    await expect(broker.submit()).rejects.toBeInstanceOf(BookBatchStopped)
    await expect(broker.call(f.options, 'b'.repeat(64))).rejects.toBeInstanceOf(BookBatchStopped)
    const delivered = { text: 'already paid response' }
    f.saved.set(`batch-result:${key}`, { result: delivered })
    expect(await broker.call(f.options, key)).toEqual(delivered)
    expect(f.provider.create).not.toHaveBeenCalled()
    expect(f.db.rpc).not.toHaveBeenCalled()
  })
  it('shares a durable three-submission budget between content repairs and transient retries, including older requests', async () => {
    const f = fixture('bank_questions'), repairKey = 'b'.repeat(64), thirdKey = 'c'.repeat(64)
    f.options.task = 'examBank.parseQuestions'
    let broker = f.broker(); await broker.poll()
    // An already submitted initial request has no retryGroup, as in the previous worker version.
    await expect(broker.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending)
    await broker.submit(); broker = f.broker(); await broker.poll()
    const repair = { ...f.options, content: 'repair question', batchRetryGroup: key }
    await expect(broker.call(repair, repairKey)).rejects.toBeInstanceOf(BookBatchPending)
    await broker.submit()
    f.provider.results.mockImplementationOnce(async () => responseStream([{ custom_id: repairKey, result: { type: 'expired' } }]))
    broker = f.broker(); await broker.poll()
    await expect(broker.call(repair, repairKey)).rejects.toBeInstanceOf(BookBatchPending)
    await broker.submit()
    f.provider.results.mockImplementationOnce(async () => responseStream([{ ...success(), custom_id: repairKey }]))
    broker = f.broker(); await broker.poll()
    await expect(broker.call({ ...repair, content: 'second repair' }, thirdKey)).rejects.toMatchObject({ attempts: 3 })
    expect(f.provider.create).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(f.provider.create.mock.calls)).not.toContain('retryGroup')
    // Accepted successful results remain reusable even after exhausting the family budget.
    expect((await broker.call(f.options, key)).text).toBe('{"groups":[]}')
  })
  it('collects missing calls, sends an independent batch request, and reuses results after restart', async () => {
    const f = fixture(), first = f.broker()
    expect(await first.poll()).toBe(false)
    await expect(first.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending)
    await first.submit()
    expect(f.provider.create).toHaveBeenCalledTimes(1)
    expect(f.provider.create.mock.calls[0]).toEqual([[expect.objectContaining({ custom_id: key, params: expect.objectContaining({ model: 'claude-sonnet-5-5' }) })]])
    const resumed = f.broker()
    expect(await resumed.poll()).toBe(false)
    const value = await resumed.call(f.options, key)
    expect(value.text).toBe('{"groups":[]}')
    expect(value.execution.transport).toBe('batch')
    expect(f.provider.create).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(f.rows)).not.toContain('test source')
  })
  it('leaves pending provider work untouched and returns without generating another request', async () => {
    const f = fixture(), first = f.broker()
    await first.poll(); await expect(first.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending); await first.submit()
    f.provider.retrieve.mockResolvedValue({ processing_status: 'in_progress' } as MessageBatch)
    expect(await f.broker().poll()).toBe(true)
    expect(f.provider.results).not.toHaveBeenCalled()
    expect(f.provider.create).toHaveBeenCalledTimes(1)
  })
  it('retries an expired individual request at most three submissions across restarts', async () => {
    const f = fixture()
    f.provider.results.mockImplementation(async () => responseStream([{ custom_id: key, result: { type: 'expired' } }]))
    let current = f.broker(); await current.poll()
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(current.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending)
      await current.submit(); current = f.broker(); await current.poll()
    }
    await expect(current.call(f.options, key)).rejects.toBeInstanceOf(BookBatchRequestFailed)
    expect(f.provider.create).toHaveBeenCalledTimes(3)
  })
  it('never resubmits a canceled request', async () => {
    const f = fixture(), first = f.broker()
    await first.poll(); await expect(first.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending); await first.submit()
    f.provider.results.mockImplementation(async () => responseStream([{ custom_id: key, result: { type: 'canceled' } }]))
    const resumed = f.broker(); await resumed.poll()
    await expect(resumed.call(f.options, key)).rejects.toBeInstanceOf(BookBatchRequestFailed)
    expect(f.provider.create).toHaveBeenCalledTimes(1)
  })
  it.each([['api_error',true],['invalid_request_error',false]] as const)('classifies %s without storing provider text in failure reasons', async (type,retryable) => {
    const f=fixture(), first=f.broker()
    await first.poll(); await expect(first.call(f.options,key)).rejects.toBeInstanceOf(BookBatchPending); await first.submit()
    f.provider.results.mockImplementation(async()=>responseStream([{custom_id:key,result:{type:'errored',error:{type:'error',error:{type,message:'private source MUST NOT LEAK'}}}} as MessageBatchIndividualResponse]))
    const resumed=f.broker();await resumed.poll()
    await expect(resumed.call(f.options,key)).rejects.toBeInstanceOf(retryable?BookBatchPending:BookBatchRequestFailed)
    expect(JSON.stringify([...f.saved.values()])).not.toContain('MUST NOT LEAK')
  })
  it('holds an uncertain create response and never replays the non-idempotent POST', async () => {
    const f = fixture(), first = f.broker()
    await first.poll(); await expect(first.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending)
    f.provider.create.mockRejectedValue(new Error('connection reset after sending'))
    await expect(first.submit()).rejects.toBeInstanceOf(BookBatchStopped)
    await expect(f.broker().poll()).rejects.toBeInstanceOf(BookBatchStopped)
    expect(f.provider.create).toHaveBeenCalledTimes(1)
  })
  it('records a definitely rejected rate-limited submission so it can be retried within the same limit', async () => {
    const f = fixture(), first = f.broker()
    await first.poll(); await expect(first.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending)
    f.provider.create.mockRejectedValueOnce(new Anthropic.APIError(429, {}, 'limited', new Headers()))
    await first.submit()
    expect(f.rows[0].state).toBe('rejected')
    const resumed = f.broker(); await resumed.poll()
    await expect(resumed.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending)
    await resumed.submit()
    expect(f.provider.create).toHaveBeenCalledTimes(2)
  })
  it('delivers a truncated result consistently instead of resetting the domain repair budget', async () => {
    const f = fixture(), first = f.broker()
    await first.poll(); await expect(first.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending); await first.submit()
    f.provider.results.mockImplementation(async () => responseStream([success('max_tokens')]))
    const resumed = f.broker(); await resumed.poll()
    expect((await resumed.call(f.options, key)).stopReason).toBe('max_tokens')
    expect((await f.broker().call(f.options, key)).stopReason).toBe('max_tokens')
    expect(f.provider.create).toHaveBeenCalledTimes(1)
  })
  it('rejects mismatched or duplicate result IDs before marking a batch complete', async () => {
    const f = fixture(), first = f.broker()
    await first.poll(); await expect(first.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending); await first.submit()
    f.provider.results.mockImplementation(async () => responseStream([success(), success()]))
    await expect(f.broker().poll()).rejects.toBeInstanceOf(BookBatchStopped)
    expect(f.rows[0].state).toBe('submitted')
  })
  it('does not route past-exam calls into the batch provider', async () => {
    const f = fixture()
    await expect(f.broker().call({ ...f.options, task: 'examBank.parseQuestions' }, key)).rejects.toBeInstanceOf(BookBatchStopped)
    expect(f.provider.create).not.toHaveBeenCalled()
  })
  it.each(['bank_questions', 'bank_explanation'] as const)('retries only the failed request for %s across worker restarts', async (kind) => {
    const f = fixture(kind), secondKey = 'b'.repeat(64)
    f.options.task = 'examBank.extractExplanations'
    const first = f.broker(); await first.poll()
    await expect(first.call(f.options, key)).rejects.toBeInstanceOf(BookBatchPending)
    await expect(first.call({ ...f.options, content: 'other question' }, secondKey)).rejects.toBeInstanceOf(BookBatchPending)
    await first.submit()
    f.provider.results.mockImplementationOnce(async () => responseStream([success(), { custom_id: secondKey, result: { type: 'expired' } }]))
    const resumed = f.broker(); await resumed.poll()
    expect((await resumed.call(f.options, key)).text).toBe('{"groups":[]}')
    await expect(resumed.call({ ...f.options, content: 'other question' }, secondKey)).rejects.toBeInstanceOf(BookBatchPending)
    await resumed.submit()
    expect(f.provider.create.mock.calls[1][0].map((r) => r.custom_id)).toEqual([secondKey])
    expect(f.rows[1].requests).toHaveLength(1)
  })
  it('rejects weekly/grade tasks and prewarm requests even for an exam batch job', async () => {
    const f = fixture('bank_questions')
    for (const task of ['week.parseAnswers', 'week.gradeSubjective', 'mockExam.answerOcr'] as const) {
      await expect(f.broker().call({ ...f.options, task }, key)).rejects.toBeInstanceOf(BookBatchStopped)
    }
    await expect(f.broker().call({ ...f.options, task: 'examBank.parseQuestions', phase: 'prewarm', maxTokens: 0 }, key)).rejects.toBeInstanceOf(BookBatchStopped)
    expect(f.provider.create).not.toHaveBeenCalled()
  })
})
