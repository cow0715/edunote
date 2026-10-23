import type { SupabaseClient } from '@supabase/supabase-js'
import { renderPdfPageToPng } from './week-reading-import'
import { regionPixels, validSourceRegion, type SourceRegion, type SourceImage } from './source-region'

/** Original PDF pixels only. No model, OCR, or text-based reconstruction. */
export async function storeSourceRegions(client: SupabaseClient, pdf: string, prefix: string,
  regions: { page: number; bbox: SourceRegion | null }[]): Promise<SourceImage[]> {
  const images: SourceImage[] = []
  const pages = new Map<number, Awaited<ReturnType<typeof renderPdfPageToPng>>>()
  for (const [i, region] of regions.entries()) {
    if (!Number.isInteger(region.page) || region.page < 1) throw Error('원본 페이지 정보가 올바르지 않습니다.')
    let rendered = pages.get(region.page)
    if (!rendered) { rendered = await renderPdfPageToPng(pdf,region.page); pages.set(region.page,rendered) }
    const bbox = validSourceRegion(region.bbox) ? region.bbox : null
    const sharp = (await import('sharp')).default
    const buffer = bbox ? await sharp(rendered.buffer).extract(regionPixels(bbox,rendered.width,rendered.height)).png().toBuffer() : rendered.buffer
    const path = `${prefix}-${i}-p${region.page}.png`
    const { error } = await client.storage.from('answer-sheets').upload(path,buffer,{contentType:'image/png',upsert:true})
    if (error) throw Error(`원본 이미지 저장 실패: ${error.message}`)
    images.push({path,page:region.page,bbox})
  }
  return images
}
