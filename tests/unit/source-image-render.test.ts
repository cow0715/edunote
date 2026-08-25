import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { renderPdfPageToPng } from '../../src/lib/week-reading-import'

/**
 * 이 렌더 경로는 조용히 실패한다 — pdfjs 가 throw 대신 경고만 남기고 **백지 PNG** 를 돌려주기 때문에
 * "에러 없이 성공"으로 보인다 (Node 20 에 `ArrayBuffer.prototype.transferToFixedLength` 가 없을 때 실제로 그랬다).
 * 그래서 성공 여부가 아니라 잉크(어두운 픽셀)가 실제로 찍혔는지를 본다.
 */
async function makePdfBase64(): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of ['PAGE ONE', 'PAGE TWO']) {
    const page = doc.addPage([595, 842])
    page.drawText(label, { x: 60, y: 740, size: 36, font })
    page.drawRectangle({ x: 60, y: 300, width: 220, height: 130, color: rgb(0.2, 0.4, 0.9) })
  }
  return Buffer.from(await doc.save()).toString('base64')
}

async function countInkPixels(buffer: Buffer): Promise<{ ink: number; total: number }> {
  const sharp = (await import('sharp')).default
  const { data } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true })
  let ink = 0
  for (const value of data) if (value < 200) ink += 1
  return { ink, total: data.length }
}

describe('renderPdfPageToPng', () => {
  it('A4 페이지를 scale 1.5 로 렌더한다', async () => {
    const rendered = await renderPdfPageToPng(await makePdfBase64(), 2)
    // 595x842pt * 1.5 = 892x1263px
    expect(rendered.width).toBe(892)
    expect(rendered.height).toBe(1263)
    expect(rendered.buffer.subarray(1, 4).toString()).toBe('PNG')
  }, 30_000)

  it('백지가 아니라 실제 내용이 그려진다', async () => {
    const rendered = await renderPdfPageToPng(await makePdfBase64(), 2)
    const { ink, total } = await countInkPixels(rendered.buffer)
    expect(ink).toBeGreaterThan(total * 0.01)
  }, 30_000)
})
