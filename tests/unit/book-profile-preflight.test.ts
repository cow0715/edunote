import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({slice:vi.fn(),read:vi.fn(),map:vi.fn()}))
vi.mock('@/lib/book-pdf/pdf',()=>({bookPageSlice:m.slice}))
vi.mock('@/lib/book-pdf/layout-source',()=>({readLayoutSource:m.read}))
vi.mock('@/lib/book-pdf/profiles',async original=>({...await original<typeof import('@/lib/book-pdf/profiles')>(),mapBookProfile:m.map}))
import { bookPilotKeys, prepareBookProfiles, saveBookProfilePlan } from '@/lib/book-pdf/profile-preflight'
import { withPdfWorkerContext, type PdfWorkerContext } from '@/lib/pdf-import/context'
import { PdfBundleDeferred } from '@/lib/pdf-import/batch-policy'
import { nativeFixture } from '../fixtures/book-native'
import type { BookManifest } from '@/lib/book-pdf/types'
import type { SupabaseClient } from '@supabase/supabase-js'
beforeEach(()=>{vi.clearAllMocks();m.slice.mockResolvedValue('JVBERi0=');m.read.mockResolvedValue(nativeFixture().pages);m.map.mockReturnValue({mapping:nativeFixture().mapping,reasons:[]})})
function fixture(){
 const unit=nativeFixture().unit
 unit.questions[0].source_kind='chapter'
 const units=Array.from({length:10},(_,n)=>({...structuredClone(unit),key:`unit-${n+1}`,order:n+1,pages:[n+2]}))
 const manifest:BookManifest={version:1,page_count:11,ignored_pages:[1],printed_years:[],filename_year:null,question_count:10,units,errors:[],warnings:[]}
 const saved=new Map<string,unknown>()
 const context:PdfWorkerContext={signal:new AbortController().signal,concurrency:2,execute:fn=>fn(),stage:async()=>{},
  read:async<T>(key:string)=>(saved.get(key)??null) as T|null,write:async(key,v)=>{saved.set(key,v)}}
 return {manifest,saved,context}
}
describe('free whole-file preflight and pinned source snapshots',()=>{
 it('includes an ambiguous window before filling the six representative slots',()=>{
   const f=fixture(),units=f.manifest.units
   units[2].questions.push({...units[2].questions[0],key:'shared-second'})
   units[3].pages=[5,6]
   units[4].questions[0].source_kind='mini_test'
   units[5].questions[0].source_kind='type'
   const sources=new Map(units.map(u=>[u.key,{pages:[],mapping:u.key==='unit-8'?null:nativeFixture().mapping,reasons:[]}]))
   const keys=bookPilotKeys(units,sources)
   expect(keys).toHaveLength(6);expect(keys).toContain('unit-8');expect(keys).toContain('unit-3')
 })
 it('reuses immutable native snapshots and a stable plan on restart',async()=>{
   const f=fixture(),run=()=>withPdfWorkerContext(f.context,()=>prepareBookProfiles(new Uint8Array(),f.manifest,'a'.repeat(64)))
   const first=await run();expect(first.plan.pilot_keys).toHaveLength(6);expect(m.slice).toHaveBeenCalledTimes(10)
   for(const [key,value] of f.saved)f.saved.set(key,JSON.parse(JSON.stringify(value)))
   m.slice.mockClear();m.read.mockClear();const second=await run()
   expect(second.plan).toEqual(first.plan);expect(m.slice).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled()
 })
 it('holds an unknown layout rather than switching a whole file to paid mapping',async()=>{
   const f=fixture();m.map.mockReturnValue({mapping:null,reasons:['unknown boundary']})
   await expect(withPdfWorkerContext(f.context,()=>prepareBookProfiles(new Uint8Array(),f.manifest,'a'.repeat(64)))).rejects.toThrow('범용 AI 전체 전환 없이')
 })
 it('rejects unsupported families before extracting additional source windows',async()=>{
   const f=fixture();delete f.manifest.units[0].questions[0].source_kind
   await expect(prepareBookProfiles(new Uint8Array(),f.manifest,'a'.repeat(64))).rejects.toThrow('AI 요청 전에')
   expect(m.slice).not.toHaveBeenCalled()
 })
 it('distinguishes a durable scheduling barrier from a quality hold',async()=>{
   const rpc=vi.fn().mockResolvedValueOnce({data:{waiting:true}}).mockResolvedValueOnce({data:{phase:'held',reason:'parser changed'}})
   const db={rpc} as unknown as SupabaseClient,job={id:'job',lease_token:'token'} as Parameters<typeof saveBookProfilePlan>[1]
   await expect(saveBookProfilePlan(db,job,{})).rejects.toBeInstanceOf(PdfBundleDeferred)
   await expect(saveBookProfilePlan(db,job,{})).rejects.toThrow('parser changed')
 })
})
