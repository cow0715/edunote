import { join } from 'node:path'
import { GlobalFonts } from '@napi-rs/canvas'
let prepared = false
/** Serverless runtimes may have no system fonts for PDFs using unembedded standard fonts. */
export function ensurePdfRenderFonts() {
  if (prepared) return
  const path = join(process.cwd(), 'assets', 'pdf-fonts', 'NotoSans.ttf')
  for (const family of ['Arial', 'Helvetica', 'sans-serif', 'serif']) {
    if (!GlobalFonts.registerFromPath(path, family)) throw Error('PDF 원본 렌더링 글꼴을 불러오지 못했습니다.')
  }
  prepared = true
}
