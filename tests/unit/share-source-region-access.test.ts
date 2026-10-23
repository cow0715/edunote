import {beforeEach,describe,it,expect,vi} from 'vitest'
const state=vi.hoisted(()=>({allowed:true,enrolled:true,locate:vi.fn(),store:vi.fn(),download:vi.fn(),signed:vi.fn()}))
vi.mock('@/lib/pdf-question-region',()=>({locateQuestionRegion:state.locate}))
vi.mock('@/lib/source-image-storage',()=>({storeSourceRegions:state.store}))
vi.mock('@/lib/share-access',()=>({SHARE_CLOSED_ERROR:'closed',SHARE_EXPIRED_ERROR:'expired',resolveShareToken:async()=>({status:'ok',student:{id:'student'}}),canViewShareByStudentId:async()=>state.allowed}))
vi.mock('@/lib/supabase/server',()=>({createServiceClient:()=>({from:(table:string)=>{
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='exam_question'?{id:'q',question_number:25,source_page:1,source_bbox:null,source_image_path:'source-images/old.png',week:{class_id:'c',answer_sheet_path:'original.pdf'}}:state.enrolled?{class_id:'c'}:null})};return q
},storage:{from:()=>({download:state.download,upload:vi.fn(),createSignedUrl:state.signed})}})}))
import {GET} from '@/app/api/share/[token]/source-image-url/route'
const run=()=>GET(new Request('https://test/api?path=source-images/old.png'),{params:Promise.resolve({token:'test'})})
beforeEach(()=>{state.allowed=true;state.enrolled=true;vi.clearAllMocks();state.signed.mockResolvedValue({data:{signedUrl:'https://signed.test/crop'},error:null});state.download.mockImplementation(async(path:string)=>path==='original.pdf'?{data:new Blob(['fixture-pdf']),error:null}:{data:null,error:{message:'missing'}});state.locate.mockResolvedValue({page:1,bbox:{x:0,y:.1,width:.5,height:.4}});state.store.mockResolvedValue([{path:'source-images/share-region-v2/new.png',page:1,bbox:null}])})
describe('share original question regions',()=>{
 it('authorizes share access and enrollment before reading or rendering a PDF',async()=>{
  state.enrolled=false;expect((await run()).status).toBe(403);expect(state.download).not.toHaveBeenCalled();expect(state.locate).not.toHaveBeenCalled()
 })
 it('recrops existing processed questions from the original PDF without AI',async()=>{
  expect((await run()).status).toBe(200);expect(state.locate).toHaveBeenCalledWith(expect.any(String),25,1,null);expect(state.store).toHaveBeenCalledOnce();expect(state.signed).toHaveBeenCalledWith('source-images/share-region-v2/new.png',3600)
 })
 it('uses the cached crop without reprocessing the original',async()=>{
  state.download.mockResolvedValue({data:new Blob(['cached']),error:null});expect((await run()).status).toBe(200);expect(state.locate).not.toHaveBeenCalled();expect(state.signed.mock.calls[0][0]).toContain('share-region-v2/q-')
 })
 it('retains the previously stored original when its source PDF is unavailable',async()=>{
  state.download.mockResolvedValue({data:null,error:{message:'missing'}});expect((await run()).status).toBe(200);expect(state.signed).toHaveBeenCalledWith('source-images/old.png',3600)
 })
})
