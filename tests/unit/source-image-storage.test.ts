import {describe,it,expect,vi} from 'vitest'
import {PDFDocument,rgb,StandardFonts} from 'pdf-lib'
import sharp from 'sharp'
import {storeSourceRegions} from '@/lib/source-image-storage'
import type {SupabaseClient} from '@supabase/supabase-js'
vi.mock('@/lib/llm/client',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/llm/client')>(),callLlmText:()=>{throw Error('Paid calls forbidden')}}))
describe('original PDF raster storage without AI',()=>{
 it('stores actual cropped chart pixels with the original page identity',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage([600,800])
  const font=await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('25. Chart question',{x:30,y:720,font,size:12})
  page.drawRectangle({x:40,y:440,width:170,height:230,color:rgb(0,0,0)})
  const uploads:Buffer[]=[]
  const upload=vi.fn(async(_path:string,b:Buffer)=>{uploads.push(b);return {error:null}})
  const client={storage:{from:()=>({upload})}} as unknown as SupabaseClient
  const images=await storeSourceRegions(client,Buffer.from(await doc.save()).toString('base64'),'source-images/bank/test/q25',[{page:1,bbox:{x:0,y:.08,width:.5,height:.45}}])
  const meta=await sharp(uploads[0]).metadata(),stats=await sharp(uploads[0]).stats()
  expect(images[0].path).toContain('p1.png');expect(meta.width).toBeLessThan(500)
  expect(stats.channels[0].min).toBe(0);expect(stats.channels[0].max).toBe(255)
 },30000)
 it('reports storage failures instead of claiming an image was saved',async()=>{
  // Page validation fails before rendering or uploading.
  await expect(storeSourceRegions({} as SupabaseClient,'','x',[{page:0,bbox:null}])).rejects.toThrow('페이지')
 })
})
