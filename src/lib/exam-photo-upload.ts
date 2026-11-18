type AnswerSheetFile = { base64: string; mimeType: string }

/** Keep a student's pages together through storage, OCR and re-reading. */
export async function packExamPhotos(files: AnswerSheetFile[]): Promise<AnswerSheetFile> {
  if (!files.length || files.some((file) => !file.base64)) throw new Error('읽을 수 없는 답안지 파일이 있습니다.')
  if (files.length === 1) return files[0]

  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  for (const [index, file] of files.entries()) {
    try {
      if (file.mimeType === 'application/pdf') {
        const source = await PDFDocument.load(file.base64)
        if (!source.getPageCount()) throw new Error('Empty PDF')
        const pages = await pdf.copyPages(source, source.getPageIndices())
        for (const page of pages) pdf.addPage(page)
      } else {
        const image = file.mimeType === 'image/png' ? await pdf.embedPng(file.base64) : await pdf.embedJpg(file.base64)
        // Fit the image within A4 dimensions without resampling it.
        const scale = Math.min(595 / image.width, 842 / image.height)
        const { width, height } = image.scale(scale)
        pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
      }
    } catch {
      throw new Error(`${index + 1}번째 파일을 합치지 못했습니다. 열 수 있는 JPG, PNG 또는 PDF로 다시 추가해 주세요.`)
    }
  }

  const base64 = await pdf.saveAsBase64()
  // Leave room for the JSON envelope in the deployment's 4.5 MB request limit.
  if (base64.length > 4_400_000) throw new Error('합친 답안지가 너무 큽니다. 파일 크기를 줄여 다시 추가해 주세요.')
  return { base64, mimeType: 'application/pdf' }
}
