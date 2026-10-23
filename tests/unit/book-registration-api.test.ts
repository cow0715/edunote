import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const m=vi.hoisted(()=>({auth:vi.fn(),service:vi.fn(),rpc:vi.fn(),download:vi.fn(),remove:vi.fn(),previous:vi.fn(),register:vi.fn()}))
vi.mock('@/lib/book-pdf/server',()=>({bookTeacher:m.auth}))
vi.mock('@/lib/supabase/service',()=>({createServiceClient:m.service}))
vi.mock('@/lib/pdf-import/server',()=>({registerPdfImport:m.register}))
import {POST} from '@/app/api/book-pdf/route'
const valid={bookCode:'suteuk_english',academicYear:2027,volume:'upper',fileName:'수능특강 영어(상).pdf',storagePath:'user/source.pdf'}
const request=(patch:Record<string,unknown>={})=>new Request('https://app/api/book-pdf',{method:'POST',body:JSON.stringify({...valid,...patch})})
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('PDF_IMPORT_WORKER_ENABLED','true');vi.stubEnv('BOOK_PDF_IMPORT_ENABLED','true')
  m.auth.mockResolvedValue({teacherId:'teacher',user:{id:'user'}})
  m.rpc.mockResolvedValue({data:{id:'doc',status:'processing',title:'2027학년도 수능특강 영어 · 상',book_code:'suteuk_english',reused:false},error:null})
  m.download.mockResolvedValue({data:new Blob(['%PDF-fixture']),error:null});m.remove.mockResolvedValue({error:null})
  m.previous.mockResolvedValue({data:null,error:null});m.register.mockResolvedValue({job_id:'job',target_id:'doc',accepted:true})
  const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:m.previous}
  m.service.mockReturnValue({rpc:m.rpc,from:()=>q,storage:{from:()=>({download:m.download,remove:m.remove})}})
})
describe('structured textbook registration',()=>{
  it.each(['suteuk_reading','suwan_english'])('blocks %s before any storage, DB reservation or paid work',async bookCode=>{
    const response=await POST(request({bookCode}))
    expect(response.status).toBe(422);expect(m.service).not.toHaveBeenCalled();expect(m.register).not.toHaveBeenCalled()
  })
  it('hashes the actual owned PDF and uses the verified Batch worker',async()=>{
    expect((await POST(request())).status).toBe(202)
    expect(m.rpc).toHaveBeenCalledWith('book_pdf_reserve',expect.objectContaining({p_hash:createHash('sha256').update('%PDF-fixture').digest('hex'),p_code:'suteuk_english',p_year:2027,p_volume:'upper'}))
    expect(m.register).toHaveBeenCalledWith(expect.objectContaining({kind:'bank_book',payload:expect.objectContaining({bookProcessing:'batch-v1'})}))
  })
  it('opens the published book without creating another job or reparsing',async()=>{
    m.rpc.mockResolvedValue({data:{id:'old',status:'published',exam_bank_id:'bank',reused:true},error:null})
    expect(await (await POST(request())).json()).toMatchObject({reused:true,document_id:'old',exam_id:'bank'})
    expect(m.register).not.toHaveBeenCalled()
  })
  it('handles a competing tab without deleting the shared document or dispatching another job',async()=>{
    m.register.mockRejectedValue(new Error('already active'))
    m.previous.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{id:'winner',status:'queued'},error:null})
    expect(await (await POST(request())).json()).toMatchObject({reused:true,job_id:'winner'})
    expect(m.register).toHaveBeenCalledTimes(1)
  })
  it('rejects wrong ownership paths and mismatched book names before downloading',async()=>{
    expect((await POST(request({storagePath:'other/file.pdf'}))).status).toBe(403)
    expect((await POST(request({fileName:'수능완성 영어.pdf'}))).status).toBe(422)
    expect(m.download).not.toHaveBeenCalled()
  })
  it('requires authentication and never accepts title-only registration',async()=>{
    m.auth.mockResolvedValueOnce({response:Response.json({}, {status:401})})
    expect((await POST(request())).status).toBe(401)
    expect((await POST(request({bookCode:undefined,title:'교재'}))).status).toBe(400)
  })
})
