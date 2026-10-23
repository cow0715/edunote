import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { GlobalFonts } from '@napi-rs/canvas'
import sharp from 'sharp'
import { ensurePdfRenderFonts } from '@/lib/pdf-render-fonts'
import { renderPdfPageToPng } from '@/lib/week-reading-import'
describe('serverless original PDF text rendering', () => {
  it('bundles standard-font fallbacks and renders letters without relying on a dark chart shape', async () => {
    ensurePdfRenderFonts()
    expect(GlobalFonts.has('Arial')).toBe(true)
    const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica)
    doc.addPage([300,200]).drawText('Original question ABC 123',{x:20,y:140,font,size:18})
    const rendered=await renderPdfPageToPng(Buffer.from(await doc.save()).toString('base64'),1)
    const pixels=await sharp(rendered.buffer).greyscale().raw().toBuffer()
    expect([...pixels].filter(value=>value<150).length).toBeGreaterThan(100)
  },30000)
})
