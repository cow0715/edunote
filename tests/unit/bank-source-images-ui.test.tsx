// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest'
import {render,screen,waitFor,cleanup} from '@testing-library/react'
import {BankSourceImages} from '@/components/exam-bank/source-images'
import {SourceImagePreview} from '@/components/grade/source-image-preview'
import type {ExamBankQuestion} from '@/components/exam-bank/types'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('original image cards',()=>{
 it('shows each saved PDF region and requests a scoped URL instead of leaking paths',async()=>{
  const fetch=vi.fn(async(url:string)=>Response.json({url:`https://signed.test/image.png?request=${encodeURIComponent(url)}`}));vi.stubGlobal('fetch',fetch)
  render(<BankSourceImages question={{id:'q',source_images:[{path:'source-images/bank/q-1.png',page:2,bbox:null},{path:'source-images/bank/q-2.png',page:3,bbox:null}]} as ExamBankQuestion}/> )
  await waitFor(()=>expect(screen.getAllByRole('img')).toHaveLength(2))
  expect(fetch.mock.calls.map(c=>String(c[0]))).toEqual(expect.arrayContaining([expect.stringContaining('/q/source-image-url?index=0'),expect.stringContaining('/q/source-image-url?index=1')]))
 })
 it('lets compact share original questions keep natural height for readable diagrams',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({url:'https://signed.test/image.png'})))
  render(<SourceImagePreview compact signedUrlEndpoint="/api/share/test/source-image-url" question={{source_image_path:'source-images/q.png',source_page:1,needs_source_image:true}} />)
  await waitFor(()=>expect(screen.getByRole('img')).toBeTruthy())
  expect(screen.getByRole('img').className).toContain('h-auto')
  expect(screen.getByRole('img').className).not.toContain('max-h-80')
 })
})

it('can recover an existing share diagram with missing saved image by question identity',async()=>{
 const fetch=vi.fn(async(url:string)=>Response.json({url:`https://signed.test/${encodeURIComponent(url)}`}));vi.stubGlobal('fetch',fetch)
 render(<SourceImagePreview sourceQuestionId="q" signedUrlEndpoint="/api/share/test/source-image-url" question={{source_image_path:null,source_page:1,needs_source_image:true}} />)
 await waitFor(()=>expect(screen.getByRole('img')).toBeTruthy())
 expect(fetch).toHaveBeenCalledWith('/api/share/test/source-image-url?questionId=q')
})
