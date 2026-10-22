import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { scheduleBookBatchWake } from '@/lib/pdf-import/batch-wake'
const fetcher=vi.fn(),id='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222'
beforeEach(()=>{
  vi.stubGlobal('fetch',fetcher);fetcher.mockReset()
  for(const [k,v]of Object.entries({GCP_PROJECT_ID:'edunote-test',GCP_WORKER_REGION:'asia-northeast3',GCP_BOOK_BATCH_QUEUE:'book-resume',GCP_BANK_PDF_JOB:'bank-worker',GCP_BOOK_BATCH_DISPATCH_ACCOUNT:'dispatcher@edunote-test.iam.gserviceaccount.com'}))vi.stubEnv(k,v)
})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
describe('book batch delayed worker wake',()=>{
  it('uses metadata credentials and a delayed OAuth task targeting only the bank worker',async()=>{
    fetcher.mockResolvedValueOnce(Response.json({access_token:'memory-token'})).mockResolvedValueOnce(Response.json({}))
    const before=Date.now(),at=await scheduleBookBatchWake(id,lease,new AbortController().signal)
    expect(Date.parse(at)-before).toBeGreaterThanOrEqual(300000)
    const body=JSON.parse(fetcher.mock.calls[1][1].body)
    expect(body.task.httpRequest.url).toBe('https://run.googleapis.com/v2/projects/edunote-test/locations/asia-northeast3/jobs/bank-worker:run')
    expect(body.task.httpRequest.oauthToken.serviceAccountEmail).toBe('dispatcher@edunote-test.iam.gserviceaccount.com')
    expect(JSON.parse(Buffer.from(body.task.httpRequest.body,'base64').toString())).toEqual({overrides:{containerOverrides:[{env:[{name:'PDF_IMPORT_JOB_ID',value:id}]}],taskCount:1}})
    expect(JSON.stringify(body)).not.toContain('memory-token')
  })
  it('treats the same named task as already scheduled rather than submitting another name',async()=>{
    fetcher.mockResolvedValueOnce(Response.json({access_token:'token'})).mockResolvedValueOnce(new Response('',{status:409}))
    await expect(scheduleBookBatchWake(id,lease,new AbortController().signal)).resolves.toEqual(expect.any(String))
  })
  it('fails before any request if continuation is unconfigured',async()=>{
    vi.stubEnv('GCP_BOOK_BATCH_QUEUE','')
    await expect(scheduleBookBatchWake(id,lease,new AbortController().signal)).rejects.toThrow('Cloud Tasks')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
