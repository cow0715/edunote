import { beforeEach, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({locate:vi.fn(),generate:vi.fn(),download:vi.fn(),path:'legacy.pdf'}))
vi.mock('@/lib/pdf-question-region',()=>({locateQuestionRegion:state.locate}))
vi.mock('@/lib/pdf-render-fonts',()=>({ensurePdfRenderFonts:vi.fn()}))
vi.mock('@/lib/week-reading-import',()=>({generateSourceImageForQuestion:state.generate}))
vi.mock('@/lib/api',()=>({
 getAuth:async()=>({user:{id:'teacher'},supabase:{from:(table:string)=>{
 const query={select:()=>query,eq:()=>query,single:async()=>({data:table==='week'?{id:'week',answer_sheet_path:state.path}:{id:'q',week_id:'week',question_number:4,source_question_number:25,needs_source_image:true,source_page:2,source_bbox:null,passage:'actual question passage'}})};return query
 },storage:{from:()=>({download:state.download})}}}),
 getTeacherId:async()=> 'teacher',assertWeekOwner:async()=>true,
 err:(error:string,status=400)=>Response.json({error},{status}),ok:(data:unknown)=>Response.json(data)
}))
import {POST} from '@/app/api/weeks/[id]/questions/[questionId]/source-image/route'
const run=()=>POST(new Request('https://test'),{params:Promise.resolve({id:'week',questionId:'q'})})
beforeEach(()=>{vi.clearAllMocks();state.path='legacy.pdf';state.download.mockResolvedValue({data:new Blob(['pdf'])});state.locate.mockResolvedValue({page:2,bbox:{x:0,y:.2,width:.5,height:.3}});state.generate.mockResolvedValue({storagePath:'image.png',error:null})})
it('checks legacy original identity before generating or saving an image',async()=>{
 const error=new Error('wrong original');error.name='SourceDocumentMismatchError';state.locate.mockRejectedValue(error)
 expect((await run()).status).toBe(422);expect(state.generate).not.toHaveBeenCalled()
})
it('uses the printed question number and verified full question region',async()=>{
 expect((await run()).status).toBe(200)
 expect(state.locate).toHaveBeenCalledWith(expect.any(String),25,2,null,['actual question passage'])
 expect(state.generate).toHaveBeenCalledWith(expect.anything(),'week',expect.any(String),{id:'q',source_page:2,source_bbox:{x:0,y:.2,width:.5,height:.3}})
})
