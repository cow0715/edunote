import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({owned:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/book-pdf/server',()=>({ownedBook:m.owned}))
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({rpc:m.rpc})}))
import { PATCH } from '@/app/api/book-pdf/[id]/classification/route'
const params={params:Promise.resolve({id:'doc'})}
const request=(data:Record<string,unknown>={})=>new Request('https://app/api/book-pdf/doc/classification',{method:'PATCH',body:JSON.stringify({bookCode:'suwan_english',volume:'practical',academicYear:2027,revision:1,...data})})
beforeEach(()=>{
  vi.clearAllMocks()
  m.owned.mockResolvedValue({teacherId:'teacher',document:{id:'doc',manifest:{printed_years:[2027],units:[{questions:[{source_kind:'practical'}]}]}}})
  m.rpc.mockResolvedValue({data:true,error:null})
})
describe('book profile classification',()=>{
  it('persists compatible metadata without dispatching a parsing job',async()=>{
    expect((await PATCH(request(),params)).status).toBe(200)
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('book_pdf_classify',expect.objectContaining({p_id:'doc',p_teacher:'teacher',p_code:'suwan_english',p_volume:'practical'}))
  })
  it('holds a wrong printed family, part or year before the mutation',async()=>{
    for(const patch of [{volume:'type'},{bookCode:'suteuk_reading',volume:'upper'},{academicYear:2026}]) {
      expect((await PATCH(request(patch),params)).status).toBe(422)
    }
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('rejects incompatible volume choices and respects ownership',async()=>{
    expect((await PATCH(request({volume:'upper'}),params)).status).toBe(400)
    m.owned.mockResolvedValue({response:Response.json({}, {status:403})})
    expect((await PATCH(request(),params)).status).toBe(403)
    expect(m.rpc).not.toHaveBeenCalled()
  })
})
