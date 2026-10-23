import { beforeEach,describe,expect,it,vi } from 'vitest'
const state=vi.hoisted(()=>({active:false,events:[] as string[],words:[] as Record<string,unknown>[],variants:[] as Record<string,unknown>[],cache:[] as Record<string,unknown>[]}))
const mocks=vi.hoisted(()=>({generate:vi.fn(),examples:vi.fn(),save:vi.fn(),saveExamples:vi.fn(),auth:vi.fn()}))
vi.mock('@/lib/db/transaction',()=>({withTeacherTransaction:async(user:string,work:(c:unknown)=>Promise<unknown>)=>{
  expect(user).toBe('verified-user');state.events.push('begin');state.active=true
  try{return await work({tx:{},teacherId:'teacher'})}finally{state.active=false;state.events.push('end')}
}}))
vi.mock('@/lib/services/vocab-enrichment',()=>({saveVariantBatch:mocks.save,saveExampleBatch:mocks.saveExamples}))
vi.mock('@/lib/vocab-variants',()=>({generateVariantMeanings:mocks.generate}))
vi.mock('@/lib/anthropic',()=>({generateVocabExamples:mocks.examples}))
vi.mock('@/lib/llm/client',()=>({createLlmExecution:()=>({}),isTaskConfigured:()=>true}))
vi.mock('@/lib/api',()=>({getAuth:mocks.auth,getTeacherId:async()=> 'teacher',assertWeekOwner:async()=>true,
  ok:(data:unknown)=>Response.json(data),err:(error:string,status=400)=>Response.json({error},{status})}))
import { enrichVocabVariantMeanings } from '@/lib/vocab-variant-enrichment'
import { POST as regenerate } from '@/app/api/weeks/[id]/vocab-words/regen-examples/route'
import { SaveError } from '@/lib/db/errors'
function client() {
  return {from:(table:string)=>{
    let head=false
    const q={select:(_?:string,options?:{head?:boolean})=>{head=!!options?.head;return q},eq:()=>q,in:()=>q,or:()=>q,order:()=>q,limit:()=>q,is:()=>q,
      then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(resolve({data:table==='vocab_word'?state.words:table==='vocab_word_variant'?state.variants:state.cache,error:null,count:head?0:undefined}))}
    return q
  }}
}
beforeEach(()=>{
  vi.clearAllMocks();state.active=false;state.events=[]
  state.words=[{id:'word',english_word:'act',correct_answer:'행동',example_sentence:null,example_translation:null,example_distractor:null,example_source:null}]
  state.variants=[{id:'variant',vocab_word_id:'word',word:'action',meaning:null,part_of_speech:'n.',relation_type:'derivative',usage_note:null,raw_text:null,needs_review:false,excluded_meanings:[],confidence:null}]
  state.cache=[]
  mocks.auth.mockResolvedValue({supabase:client(),user:{id:'verified-user'}})
  mocks.generate.mockImplementation(async()=>{expect(state.active).toBe(false);state.events.push('ai');return [{id:'variant',word:'action',part_of_speech:'n.',meaning:'행동',usage_note:null,excluded_meanings:[],needs_review:false,confidence:0.9}]})
  mocks.examples.mockImplementation(async()=>{expect(state.active).toBe(false);state.events.push('ai');return [{id:'word',sentence:'Take action.',translation:'행동하라.',distractor:null}]})
  mocks.save.mockImplementation(async()=>{expect(state.active).toBe(true);state.events.push('save')})
  mocks.saveExamples.mockImplementation(async()=>{expect(state.active).toBe(true);state.events.push('save');return 1})
})
describe('enrichment model calls stay outside transactions',()=>{
  it('generates variant meanings first and submits a single server-only persistence plan',async()=>{
    await enrichVocabVariantMeanings(client() as never,{weekId:'week'},'verified-user')
    expect(state.events).toEqual(['ai','begin','save','end'])
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.save.mock.calls[0][2][0].source).toMatchObject({id:'word',english_word:'act'})
    expect(mocks.save.mock.calls[0][4]).toEqual(['variant'])
  })
  it('supports cache-only persistence without a model call or cache rewrite',async()=>{
    state.cache=[{word_key:'action',word:'action',part_of_speech:'n.',meaning:'행동',usage_note:null,excluded_meanings:[],confidence:0.9,relation_type:'derivative'}]
    const result=await enrichVocabVariantMeanings(client() as never,{weekId:'week',cacheOnly:true},'verified-user')
    expect(mocks.generate).not.toHaveBeenCalled();expect(result.updated).toBe(1)
    expect(mocks.save.mock.calls[0][4]).toEqual([])
  })
  it('does not write cached variants early when generation of another variant fails',async()=>{
    state.variants.push({...state.variants[0],id:'other',word:'actor'})
    state.cache=[{word:'action',part_of_speech:'n.',meaning:'행동'}]
    mocks.generate.mockRejectedValueOnce(new Error('model failure'))
    await expect(enrichVocabVariantMeanings(client() as never,{weekId:'week'},'verified-user')).rejects.toThrow('model failure')
    expect(mocks.save).not.toHaveBeenCalled();expect(state.events).toEqual([])
  })
  it('generates examples before opening the save transaction',async()=>{
    const response=await regenerate(new Request('https://example.test'),{params:Promise.resolve({id:'week'})})
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({generated:1,saved:1,failedBatches:0})
    expect(state.events).toEqual(['ai','begin','save','end'])
  })
  it('returns 409 for stale example output instead of reporting it saved',async()=>{
    mocks.saveExamples.mockRejectedValueOnce(new SaveError('stale',409))
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    try {
      const response=await regenerate(new Request('https://example.test'),{params:Promise.resolve({id:'week'})})
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({error:'stale'})
    }finally{log.mockRestore()}
  })
})
