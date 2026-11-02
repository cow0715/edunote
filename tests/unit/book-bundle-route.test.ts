import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
const m=vi.hoisted(()=>({auth:vi.fn(),service:vi.fn(),register:vi.fn(),dispatch:vi.fn()}))
vi.mock('@/lib/book-pdf/server',()=>({bookTeacher:m.auth}))
vi.mock('@/lib/supabase/service',()=>({createServiceClient:m.service}))
vi.mock('@/lib/pdf-import/server',()=>({registerPdfImport:m.register}))
vi.mock('@/lib/pdf-import/gcp',()=>({dispatchPdfJob:m.dispatch}))
import { POST } from '@/app/api/book-pdf/bundles/route'
import { BOOK_PROFILE_VERSION } from '@/lib/book-pdf/profiles'
type Job={id:string;target_id:string;status:string;payload:Record<string,unknown>}
function fixture(legacy=false,ready=false){
 const teacher=randomUUID(),bundle=randomUUID(),jobs:Job[]=[],links:{position:number;document_id:string;job_id:string|null}[]=[],events:string[]=[]
 const names=['수능영독(상).pdf','수특영독(하).pdf','수완(유형).pdf','수완(실전).pdf'],volumes=['upper','lower','type','practical']
 const files=names.map((fileName,n)=>({fileName,storagePath:`user/${n}.pdf`,bookCode:n<2?'suteuk_reading':'suwan_english',volume:volumes[n],academicYear:2027}))
 const docs=files.map(file=>({id:randomUUID(),teacher_id:teacher,status:'processing',book_code:file.bookCode,volume:file.volume,academic_year:file.academicYear,title:file.fileName}))
 if(legacy)for(const doc of docs)jobs.push({id:randomUUID(),target_id:doc.id,status:'failed',payload:{bookProcessing:'batch-v1'}})
 if(ready)for(const [n,doc]of docs.entries()){const job={id:randomUUID(),target_id:doc.id,status:n===3?'failed':'queued',payload:{bundleId:bundle}};jobs.push(job);links.push({position:n,document_id:doc.id,job_id:job.id})}
 const download=vi.fn(async(path:string)=>({data:new Blob(['%PDF-1.7\n',path]),error:null})),remove=vi.fn(async()=>({error:null}))
 let nextDoc=0
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='book_pdf_bundle_open')return{data:{id:bundle,ready},error:null}
  if(name==='book_pdf_reserve')return{data:docs[nextDoc++],error:null}
  if(name==='book_pdf_bundle_seal'){events.push('sealed');return{error:null}}
  if(name==='book_pdf_bundle_attach'){
   const old=links.find(l=>l.position===args.p_position)
   if(old)old.job_id=String(args.p_job??old.job_id)
   else links.push({position:Number(args.p_position),document_id:String(args.p_document),job_id:args.p_job?String(args.p_job):null})
   return{error:null}
  }
  return{error:null}
 })
 const db={rpc,storage:{from:()=>({download,remove})},from(table:string){
  const filters:Record<string,unknown>={}
  const q={select:()=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q},order:()=>q,limit:()=>q,update:()=>q,
   maybeSingle:async()=>({data:jobs.find(j=>j.target_id===filters.target_id)??null,error:null}),
   single:async()=>({data:table==='book_pdf_document'?docs.find(d=>d.id===filters.id):jobs.find(j=>j.id===filters.id),error:null}),
   then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='book_pdf_bundle_file'?links:[],error:null}).then(resolve)}
  return q
 }}
 m.auth.mockResolvedValue({teacherId:teacher,user:{id:'user'}});m.service.mockReturnValue(db)
 m.register.mockImplementation(async(input:{targetId:string;payload:Record<string,unknown>})=>{const job={id:randomUUID(),target_id:input.targetId,status:'queued',payload:input.payload};jobs.push(job);events.push('registered');return{job_id:job.id}})
 m.dispatch.mockImplementation(async()=>{events.push('dispatched')})
 return{files,docs,jobs,links,events,download,rpc,bundle,requestKey:randomUUID()}
}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('PDF_IMPORT_WORKER_ENABLED','true');vi.stubEnv('BOOK_PDF_IMPORT_ENABLED','true')})
afterEach(()=>vi.unstubAllEnvs())
const request=(payload:unknown)=>new Request('https://example.test/api/book-pdf/bundles',{method:'POST',body:JSON.stringify(payload)})
describe('idempotent book bundle registration API',()=>{
 it('links four stopped legacy jobs and preserves their status without dispatching or registering replacements',async()=>{
  const f=fixture(true),response=await POST(request({requestKey:f.requestKey,files:f.files}))
  expect(response.status).toBe(202);expect(m.register).not.toHaveBeenCalled();expect(m.dispatch).not.toHaveBeenCalled()
  expect(f.links.map(l=>l.job_id)).toEqual(f.jobs.map(j=>j.id));expect(f.jobs.every(j=>j.status==='failed')).toBe(true)
 })
 it('seals every file before dispatching new work and pins the profile version',async()=>{
  const f=fixture(),response=await POST(request({requestKey:f.requestKey,files:f.files}))
  expect(response.status).toBe(202);expect(m.register).toHaveBeenCalledTimes(4)
  for(const [input] of m.register.mock.calls)expect(input).toMatchObject({deferDispatch:true,payload:{bookProfile:BOOK_PROFILE_VERSION,bundleId:f.bundle}})
  expect(f.events.indexOf('sealed')).toBeLessThan(f.events.indexOf('dispatched'))
 })
 it('can finish a committed registration retry without touching failed jobs or downloading the PDFs again',async()=>{
  const f=fixture(false,true),response=await POST(request({requestKey:f.requestKey,files:f.files}))
  expect(response.status).toBe(200);expect(f.download).not.toHaveBeenCalled();expect(m.register).not.toHaveBeenCalled();expect(m.dispatch).toHaveBeenCalledTimes(3)
  expect(f.jobs[3].status).toBe('failed')
 })
 it('rejects foreign paths and duplicate objects before reserving a bundle',async()=>{
  const f=fixture();f.files[0].storagePath='someone-else/file.pdf'
  expect((await POST(request({requestKey:f.requestKey,files:f.files}))).status).toBe(422)
  expect(f.rpc).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled()
 })
 it('authenticates before reading request data or using the service role',async()=>{
  fixture();m.auth.mockResolvedValue({response:Response.json({error:'login'},{status:401})})
  expect((await POST(request({}))).status).toBe(401);expect(m.service).not.toHaveBeenCalled()
 })
})
