import { validSourceRegion, type SourceRegion } from './source-region'
import type { SourcePage } from './book-pdf/source-map'
export function questionRegionFromPage(page: SourcePage, number: number): SourceRegion | null {
  const anchors=page.lines.flatMap((line)=>{
    const match=line.text.trim().match(/^(\d{1,3})(?:[.)](?:\s|$)|번(?:\s|$))/)
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
export async function locateQuestionRegion(pdf: string, number: number, pageHint: number | null, bbox: SourceRegion | null, expectedTexts?: string[]) {
  const {readLayoutSource}=await import('./book-pdf/layout-source')
  const {bookPageSlice}=await import('./book-pdf/pdf')
  const bytes=new Uint8Array(Buffer.from(pdf,'base64'))
  const pages=pageHint ? await readLayoutSource(new Uint8Array(Buffer.from(await bookPageSlice(bytes,[pageHint]),'base64')),[pageHint]) : await readLayoutSource(bytes)
  if (expectedTexts?.some((text)=>text.trim()) && !sourceTextMatches(pages,expectedTexts)) {
    const error=new Error('저장된 원본 PDF와 문항 내용이 일치하지 않습니다. 해당 주차의 올바른 원본 시험지를 다시 등록해 주세요.')
    error.name='SourceDocumentMismatchError'
    throw error
  }
  const matches=pages.flatMap((page)=>{const region=questionRegionFromPage(page,number);return region ? [{page:page.page,bbox:region}] : []})
  if(matches.length===1) return matches[0]
  if(pageHint) return {page:pageHint,bbox:validSourceRegion(bbox) ? bbox : null}
  throw Error(`${number}번 원본 페이지를 확정하지 못했습니다. 원본 좌표 확인이 필요합니다.`)
}

/** Legacy filenames were reusable. Never display another exam solely because page/bbox look valid. */
export function sourceTextMatches(pages: SourcePage[], expectedTexts: string[]): boolean {
  const normalize=(text:string)=>text.replace(/<[^>]*>/g,'').toLowerCase().replace(/[^a-z0-9가-힣]/g,'')
  const source=normalize(pages.flatMap((p)=>p.lines.map((l)=>l.text)).join(' '))
  return expectedTexts.some((text)=>{
    const words=text.match(/[a-zA-Z]+(?:['’][a-zA-Z]+)?/g) ?? []
    for(let i=0;i+5<=words.length;i+=3) {
      const signature=normalize(words.slice(i,i+5).join(' '))
      if(signature.length>=24 && source.includes(signature)) return true
    }
    const korean=normalize(text).replace(/[a-z0-9]/g,'')
    return korean.length>=35 && source.includes(korean.slice(0,70))
  })
}
