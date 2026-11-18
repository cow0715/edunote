import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { packExamPhotos } from '@/lib/exam-photo-upload'

const png = {
  mimeType: 'image/png',
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT2QAAAAASUVORK5CYII=',
}

describe('학생 답안지 여러 장 묶기', () => {
  it('한 장은 원본 업로드 형식을 유지한다', async () => {
    await expect(packExamPhotos([png])).resolves.toBe(png)
  })

  it('사진과 여러 페이지 PDF를 추가한 순서대로 보관한다', async () => {
    const original = await PDFDocument.create()
    original.addPage([300, 400])
    original.addPage([400, 300])
    const upload = await packExamPhotos([png, { mimeType: 'application/pdf', base64: await original.saveAsBase64() }])
    expect(upload.mimeType).toBe('application/pdf')
    const combined = await PDFDocument.load(upload.base64)
    expect(combined.getPages().map((page) => page.getSize())).toEqual([
      { width: 595, height: 595 }, { width: 300, height: 400 }, { width: 400, height: 300 },
    ])
  })

  it('손상된 뒷장이 있으면 일부 페이지만 저장하지 않는다', async () => {
    await expect(packExamPhotos([png, { mimeType: 'image/jpeg', base64: 'YQ==' }])).rejects.toThrow('2번째 파일')
  })
})
