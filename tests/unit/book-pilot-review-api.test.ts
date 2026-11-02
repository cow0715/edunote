import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({user:true,job:null as null|Record<string,unknown>,rpc:vi.fn(),filters:[] as unknown[][]}))
vi.mock('@/lib/api',()=>({getAuth:async()=>({user:m.user?{id:'owner'}:null,supabase:{from:()=>{const q={select:()=>q,eq:(...args:unknown[])=>{m.filters.push(args);return q},single:async()=>({data:m.job,error:null})};return q}}}),getTeacherId:async()=>'teacher',ok:(data:unknown)=>Response.json(data),err:(error:string,status=400)=>Response.json({error},{status})}))
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({rpc:m.rpc})}))
import { GET,POST } from '@/app/api/pdf-import/jobs/[id]/pilot-review/route'
const id='11111111-1111-4111-8111-111111111111',params={params:Promise.resolve({id})},snapshot='a'.repeat(32)
const request=(body:unknown)=>new Request('https://example.com',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();m.filters=[];m.user=true;m.job={id,kind:'bank_book',target_id:'doc',payload:{}};m.rpc.mockResolvedValue({data:{approved:true,resumed:false},error:null})})
describe('pilot approval is passive and owned',()=>{
  it('loads only owner-scoped book information',async()=>{
    expect((await GET(new Request('https://example.com'),params)).status).toBe(200)
    expect(m.filters).toContainEqual(['teacher_id','teacher'])
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('book_pdf_pilot_review_info',{p_doc:'doc',p_teacher:'teacher'})
  })
  it('stores explicit approval without dispatching or retrying',async()=>{
    const response=await POST(request({snapshot,confirm:true}),params)
    expect(await response.json()).toEqual({approved:true,resumed:false})
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('book_pdf_pilot_approve',{p_doc:'doc',p_teacher:'teacher',p_snapshot:snapshot,p_confirm:true})
  })
  it.each([{snapshot,confirm:false},{snapshot},{snapshot:'invalid',confirm:true},{snapshot,confirm:true,resume:true}])('rejects incomplete or unexpected approval input %j',async(body)=>{
    expect((await POST(request(body),params)).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled()
  })
  it('rejects auth failures, missing books and excluded volumes',async()=>{
    m.user=false;expect((await POST(request({snapshot,confirm:true}),params)).status).toBe(401)
    m.user=true;m.job=null;expect((await POST(request({snapshot,confirm:true}),params)).status).toBe(404)
    m.job={kind:'bank_book',payload:{recoveryExcluded:true}};expect((await POST(request({snapshot,confirm:true}),params)).status).toBe(409)
    expect(m.rpc).not.toHaveBeenCalled()
  })
})
