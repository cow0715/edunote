import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readBookPages } from '@/lib/book-pdf/pdf'

describe('native textbook column boundaries', () => {
  it('excludes the publisher side tab without losing text inside the right body column', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([600, 800])
    page.drawText('Original passage.', { x: 40, y: 700, font, size: 10 })
    page.drawText('Right column ending.', { x: 310, y: 700, font, size: 10 })
    page.drawText('S', { x: 578, y: 700, font, size: 10 })
    page.drawText('T', { x: 578, y: 680, font, size: 10 })
    const [native] = await readBookPages(await pdf.save())
    expect(native.left).toBe('Original passage.')
    expect(native.right).toBe('Right column ending.')
    expect(native.full).toContain('S')
  })
  it('derives a source underline hint from actual PDF strokes and text coordinates', async () => {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([600, 800])
    page.drawText('not', { x: 40, y: 700, font, size: 10 })
    page.drawLine({ start: { x: 40, y: 697.5 }, end: { x: 54, y: 697.5 }, thickness: 0.6, color: rgb(0, 0, 0) })
    page.drawText('decoration', { x: 40, y: 600, font, size: 10 })
    page.drawLine({ start: { x: 40, y: 597.5 }, end: { x: 90, y: 597.5 }, thickness: 0.6, color: rgb(1, 0, 0) })
    const [native] = await readBookPages(await pdf.save())
    expect(native.underlines).toEqual([{ page: 1, side: 'left', text: 'not', context: 'not' }])
  })
  it('reads emphasized English body text from the actual serif bold font', async () => {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.TimesRomanBold), page = pdf.addPage([600, 800])
    page.drawText('(a) word', { x: 40, y: 700, font, size: 10 })
    const [native] = await readBookPages(await pdf.save())
    expect(native.bold).toEqual([{ page: 1, side: 'left', text: '(a) word', context: '(a) word' }])
  })
})
