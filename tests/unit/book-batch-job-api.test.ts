import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import type { PdfImportJob } from '@/lib/pdf-import/types'
const mocks=vi.hoisted(()=>({job:null as PdfImportJob|null,dispatch:vi.fn(),service:vi.fn()}))
vi.mock('@/lib/api',()=>({getAuth:async()=>({user:{id:'owner'},supabase:{from:()=>{const query={select:()=>query,eq:()=>query,single:async()=>({data:mocks.job,error:null})};return query}}}),getTeacherId:async()=>'teacher',
  ok:(data:unknown,init?:ResponseInit)=>Response.json(data,init),err:(error:string,status=400)=>Response.json({error},{status})}))
vi.mock('@/lib/supabase/service',()=>({createServiceClient:mocks.service}))
vi.mock('@/lib/pdf-import/gcp',()=>({dispatchPdfJob:mocks.dispatch,gcpWorkerConfig:vi.fn()}))
import {POST} from '@/app/api/pdf-import/jobs/[id]/route'
const id='11111111-1111-4111-8111-111111111111',params={params:Promise.resolve({id})}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('PDF_IMPORT_WORKER_ENABLED','true');mocks.dispatch.mockResolvedValue(undefined)
  mocks.job={id,teacher_id:'teacher',kind:'bank_book',target_id:'doc',status:'waiting_batch',stage:'배치 대기',payload:{bookProcessing:'batch-v1'},source_path:'private.pdf',completed_calls:1,attempt:10,lease_token:null,lease_expires_at:null,result:null,error:null,created_at:'',updated_at:'',resume_after:new Date(Date.now()+300000).toISOString()}
})
afterEach(()=>vi.unstubAllEnvs())
describe('batch continuation recovery API',()=>{
  it('does not let a user prematurely restart normal batch waiting',async()=>{
    expect((await POST(new Request('https://example.com'),params)).status).toBe(409)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('wakes the existing stalled job without resetting request or lease counters',async()=>{
    mocks.job!.resume_after=new Date(Date.now()-31*60000).toISOString()
    expect((await POST(new Request('https://example.com'),params)).status).toBe(202)
    expect(mocks.dispatch).toHaveBeenCalledWith(id,'bank_book')
    expect(mocks.service).not.toHaveBeenCalled()
  })
  it('blocks replay of a submission whose acceptance is uncertain',async()=>{
    mocks.job!.status='failed';mocks.job!.result={batch_stopped:true}
    expect((await POST(new Request('https://example.com'),params)).status).toBe(409)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it.each(['bank_questions','bank_explanation'] as const)('recovers a delayed %s batch without replacing the job or retry budget',async(kind)=>{
    mocks.job!.kind=kind;mocks.job!.payload={batchProcessing:'batch-v1'}
    mocks.job!.resume_after=new Date(Date.now()-31*60000).toISOString()
    expect((await POST(new Request('https://example.com'),params)).status).toBe(202)
    expect(mocks.dispatch).toHaveBeenCalledWith(id,kind)
    expect(mocks.service).not.toHaveBeenCalled()
  })
  it('blocks manual replay after an individual request exhausts its limit',async()=>{
    mocks.job!.kind='bank_explanation';mocks.job!.status='failed';mocks.job!.result={batch_exhausted:true}
    expect((await POST(new Request('https://example.com'),params)).status).toBe(409)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
