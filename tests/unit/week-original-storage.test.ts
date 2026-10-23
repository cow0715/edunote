import { describe, expect, it, vi } from 'vitest'
import { saveWeekAnswerSheetFile } from '@/lib/week-reading-import'
type Client = Parameters<typeof saveWeekAnswerSheetFile>[0]
function setup(uploadError: {message:string} | null = null, linkError: {message:string} | null = null) {
 const upload=vi.fn().mockResolvedValue({error:uploadError})
 const eq=vi.fn().mockResolvedValue({error:linkError})
 const update=vi.fn(()=>({eq}))
 const client={storage:{from:()=>({upload})},from:()=>({update})} as unknown as Client
 return {client,upload,update}
}
describe('week original PDF preservation',()=>{
 it('isolates repeated sanitized filenames across weeks and repeated imports',async()=>{
  const {client,upload}=setup()
  for(const week of ['week-a','week-b','week-a']) await saveWeekAnswerSheetFile(client,week,'cGRm','application/pdf','서울 week5 (해설).pdf')
  const paths=upload.mock.calls.map(c=>c[0] as string)
  expect(new Set(paths).size).toBe(3)
  expect(paths[0]).toMatch(/^week-a\//)
  expect(paths[1]).toMatch(/^week-b\//)
  for(const call of upload.mock.calls) expect(call[2].upsert).toBe(false)
 })
 it('fails before replacing questions when original upload fails',async()=>{
  const {client,update}=setup({message:'storage unavailable'})
  await expect(saveWeekAnswerSheetFile(client,'week','cGRm','application/pdf')).rejects.toThrow('원본 PDF 저장 실패')
  expect(update).not.toHaveBeenCalled()
 })
 it('aborts on a storage key collision without updating the week link',async()=>{
  const {client,upload,update}=setup({message:'The resource already exists'})
  await expect(saveWeekAnswerSheetFile(client,'week','cGRm','application/pdf','같은 이름.pdf')).rejects.toThrow('already exists')
  expect(upload.mock.calls[0][2].upsert).toBe(false)
  expect(update).not.toHaveBeenCalled()
 })
 it('propagates a failed week link rather than silently keeping an older original',async()=>{
  const {client}=setup(null,{message:'database unavailable'})
  await expect(saveWeekAnswerSheetFile(client,'week','cGRm','application/pdf')).rejects.toThrow('원본 PDF 연결 실패')
 })
})
