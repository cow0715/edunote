import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { getPdfWorkerContext } from '../pdf-import/context'
import type { SourceAuditImage } from './audit-source'

/** Render original PDF instructions independently of PDF.js text extraction.
 * Only this bounded unit is rasterized; temp files are removed after encoding. */
export async function renderBookSourceImages(bytes: Uint8Array, originalPages: number[]): Promise<SourceAuditImage[]> {
  if (!originalPages.length || originalPages.length > 4 || new Set(originalPages).size !== originalPages.length) throw Error('이미지 검증은 1~4페이지 지문 묶음만 지원합니다.')
  const dir = await mkdtemp(join(tmpdir(), 'edunote-book-')), file = join(dir, 'source.pdf'), prefix = join(dir, 'page')
  try {
    getPdfWorkerContext()?.signal.throwIfAborted()
    await writeFile(file, bytes)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.PDF_RENDERER_PATH || 'pdftoppm', ['-png', '-scale-to-y', '2000', '-scale-to-x', '-1', file, prefix],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal: getPdfWorkerContext()?.signal })
      let diagnostic = ''
      child.stderr.on('data', (data: Buffer) => { if (diagnostic.length < 2000) diagnostic += data.toString().slice(0, 2000 - diagnostic.length) })
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolve() : reject(Error(`PDF 원본 이미지 렌더링 실패 (${code}): ${diagnostic}`)))
    })
    const files = (await readdir(dir)).filter((f) => /^page-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    if (files.length !== originalPages.length) throw Error('원본 이미지 페이지 수가 일치하지 않습니다.')
    const images: SourceAuditImage[] = []
    for (const [i, name] of files.entries()) {
      const data = await readFile(join(dir, name))
      images.push({ page: originalPages[i], data: data.toString('base64'), sha256: createHash('sha256').update(data).digest('hex') })
    }
    return images
  } finally {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('edunote-book-')) throw Error('검증 이미지 임시 경로가 올바르지 않습니다.')
    await rm(dir, { recursive: true, force: true })
  }
}
