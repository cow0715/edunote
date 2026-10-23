import { validSourceRegion, type SourceRegion } from './source-region'
import type { SourcePage } from './book-pdf/source-map'
export function questionRegionFromPage(page: SourcePage, number: number): SourceRegion | null {
  const anchors=page.lines.flatMap((line)=>{
    const match=line.text.trim().match(/^(\d{1,3})[.)](?:\s|$)/)
    return match ? [{...line,number:Number(match[1])}] : []
  })
  const found=anchors.filter((a)=>a.number===number)
  if(found.length!==1) return null // Never choose between ambiguous duplicate printed numbers.
  const twoColumns=anchors.some((a)=>a.x>=page.width/2) && anchors.some((a)=>a.x<page.width/2)
  const first=found[0], rightColumn=twoColumns && first.x>=page.width/2
  const next=anchors.filter((a)=>a.number>number && Math.abs(a.x-first.x)<16 && (!twoColumns || (a.x>=page.width/2)===rightColumn) && a.y<first.y)
    .sort((a,b)=>b.y-a.y)[0]
  const top=Math.min(page.height,first.y+first.height+4), bottom=next ? next.y+next.height+6 : page.height*0.04
  if(top<=bottom) return null
  const x=rightColumn ? 0.5 : 0
  return {x,y:1-top/page.height,width:twoColumns ? 0.5 : 1,height:(top-bottom)/page.height}
}
/** Deterministic PDF geometry; does not run OCR or an LLM. */
export async function locateQuestionRegion(pdf: string, number: number, pageHint: number | null, bbox: SourceRegion | null) {
  const {readLayoutSource}=await import('./book-pdf/layout-source')
  const {bookPageSlice}=await import('./book-pdf/pdf')
  const bytes=new Uint8Array(Buffer.from(pdf,'base64'))
  const pages=pageHint ? await readLayoutSource(new Uint8Array(Buffer.from(await bookPageSlice(bytes,[pageHint]),'base64')),[pageHint]) : await readLayoutSource(bytes)
  const matches=pages.flatMap((page)=>{const region=questionRegionFromPage(page,number);return region ? [{page:page.page,bbox:region}] : []})
  if(matches.length===1) return matches[0]
  if(pageHint) return {page:pageHint,bbox:validSourceRegion(bbox) ? bbox : null}
  throw Error(`${number}번 원본 페이지를 확정하지 못했습니다. 원본 좌표 확인이 필요합니다.`)
}
