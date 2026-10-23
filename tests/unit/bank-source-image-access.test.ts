import {describe,it,expect,vi,beforeEach} from 'vitest'
const state=vi.hoisted(()=>({teacher:'owner',user:true,row:null as unknown,signed:vi.fn(),eq:vi.fn()}))
vi.mock('@/lib/api',()=>({getAuth:async()=>({user:state.user?{id:'auth'}:null,supabase:{from:()=>({select:()=>({eq:state.eq})}),storage:{from:()=>({createSignedUrl:state.signed})}}}),getTeacherId:async()=>state.teacher,err:(error:string,status=400)=>Response.json({error},{status}),ok:(data:unknown)=>Response.json(data)}))
import {GET} from '@/app/api/exam-bank/questions/[questionId]/source-image-url/route'
beforeEach(()=>{state.user=true;state.row=null;state.eq.mockReset();state.eq.mockReturnValue({eq:state.eq,maybeSingle:async()=>({data:state.row})});state.signed.mockReset();state.signed.mockResolvedValue({data:{signedUrl:'https://signed.test/image'},error:null})})
describe('bank image authorization',()=>{
 it('requires a teacher-owned question before issuing a storage URL',async()=>{
  const response=await GET(new Request('https://test/api?index=0'),{params:Promise.resolve({questionId:'q'})})
  expect(response.status).toBe(404);expect(state.eq).toHaveBeenCalledWith('exam_bank.teacher_id','owner');expect(state.signed).not.toHaveBeenCalled()
 })
 it('does not accept arbitrary path or an out-of-range index',async()=>{
  state.row={source_images:[{path:'private/secret'}]}
  expect((await GET(new Request('https://test/api'),{params:Promise.resolve({questionId:'q'})})).status).toBe(404)
  state.row={source_images:[{path:'source-images/bank/b/q.png'}]}
  expect((await GET(new Request('https://test/api?index=9'),{params:Promise.resolve({questionId:'q'})})).status).toBe(404)
  expect(state.signed).not.toHaveBeenCalled()
 })
 it('signs only the exact saved image on the owned row',async()=>{
  state.row={source_images:[{path:'source-images/bank/b/q.png'}]}
  expect((await GET(new Request('https://test/api'),{params:Promise.resolve({questionId:'q'})})).status).toBe(200)
  expect(state.signed).toHaveBeenCalledWith('source-images/bank/b/q.png',3600)
 })
})
