import type { SourceMap, SourcePage } from './source-map'
import type { SourceRegion } from '../source-region'
export type BookVisualRegion = { key: string; page: number; bbox: SourceRegion }
/** Use audited native references to bound the complete printed question, including whitespace occupied by graphics. */
export function bookVisualRegions(pages: SourcePage[], mapping: SourceMap, visualRequired = false): BookVisualRegion[] {
  return mapping.groups.flatMap((group) => (group.visual.length || visualRequired || group.questions.some((q)=>q.type === 'chart' || pages.some((page)=>page.lines.some((line)=>q.stem.some((ref)=>line.id>=ref.s && line.id<=ref.e) && /그림|도표|그래프|지도|표의|표를/.test(line.text))))) ? group.questions.flatMap((q) => {
    const refs = [...group.passage,...group.visual,...q.label,...q.stem,...(q.choices ?? []).flat()]
    return pages.flatMap((page) => {
      const lines = page.lines.filter((line) => refs.some((ref) => line.id >= ref.s && line.id <= ref.e))
      if (!lines.length) return []
      const left = Math.min(...lines.map((l)=>l.x)), right = Math.max(...lines.map((l)=>l.x+l.width))
      const bottom = Math.min(...lines.map((l)=>l.y)), top = Math.max(...lines.map((l)=>l.y+l.height))
      // Text bounds alone can omit image edges. Extend to the containing column horizontally.
      const x = left >= page.width/2 ? page.width/2 : 0
      const edge = right <= page.width/2 ? page.width/2 : page.width
      return [{key:q.id,page:page.page,bbox:{x:x/page.width,y:Math.max(0,1-top/page.height),width:(edge-x)/page.width,height:Math.min(1,(top-bottom)/page.height)}}]
    })
  }) : [])
}
