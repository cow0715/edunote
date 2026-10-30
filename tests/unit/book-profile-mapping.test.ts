import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({cached:vi.fn(),call:vi.fn()}))
vi.mock('@/lib/book-pdf/checkpoints',()=>({readCachedBookCall:m.cached}))
vi.mock('@/lib/llm/client',()=>({callLlmTextDetailed:m.call,buildFileBlock:(data:string,mimeType:string)=>({data,mimeType}),parseJsonObjectResponse:(s:string)=>JSON.parse(s)}))
import { mapBookSource } from '@/lib/book-pdf/map-source'
import { sourceAuditFixture } from '../fixtures/book-source-audit'
beforeEach(()=>{vi.clearAllMocks();m.cached.mockResolvedValue(null)})
describe('native profile mapping with compatibility-first reuse',()=>{
  it('avoids model mapping when the profile assigns every native character',async()=>{
    const f=sourceAuditFixture(),result=await mapBookSource({pages:f.pages,pdf:'original',profileMapping:f.mapping})
    expect(result.resolved.errors).toEqual([]);expect(result.mapping).toEqual(f.mapping);expect(m.call).not.toHaveBeenCalled()
  })
  it('prefers an already-paid exact response to a fresh code candidate',async()=>{
    const f=sourceAuditFixture(),old=structuredClone(f.mapping)
    old.issues=['stored annotation']
    m.cached.mockResolvedValue({text:JSON.stringify(old),stopReason:'end_turn',usage:{}})
    const result=await mapBookSource({pages:f.pages,pdf:'original',profileMapping:f.mapping})
    expect(result.mapping).toEqual(old);expect(m.call).not.toHaveBeenCalled()
  })
  it('uses a complete profile instead of repeatedly repairing an invalid paid mapping',async()=>{
    const f=sourceAuditFixture(),bad=structuredClone(f.mapping)
    bad.groups[0].passage=[{s:999999,e:999999}]
    m.cached.mockResolvedValue({text:JSON.stringify(bad),stopReason:'end_turn',usage:{}})
    const result=await mapBookSource({pages:f.pages,pdf:'original',profileMapping:f.mapping})
    expect(result.resolved.errors).toEqual([]);expect(result.mapping).toEqual(f.mapping)
    expect(m.call).not.toHaveBeenCalled()
  })
})
