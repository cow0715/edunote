import { createHash } from 'node:crypto'
import { ok, err } from '@/lib/api'
import { bookTeacher } from '@/lib/book-pdf/server'
import { createServiceClient } from '@/lib/supabase/service'
import { registerPdfImport } from '@/lib/pdf-import/server'
import { workerEnabled } from '@/lib/pdf-import/types'
import { bookFileHints, getBook } from '@/lib/book-pdf/catalog'
import { bookUploadSchema } from '@/lib/book-pdf/registration-schema'
import type { BookDocument } from '@/lib/book-pdf/types'

export async function GET() {
  const auth = await bookTeacher()
  if (auth.response) return auth.response
  const { data, error } = await auth.supabase!.from('book_pdf_document')
    .select('id,title,academic_year,book_code,volume,status,revision,exam_bank_id,created_at').eq('teacher_id', auth.teacherId!).order('created_at', { ascending: false }).limit(100)
  if (error) return err('교재 분류 DB 설정이 필요합니다.', 503)
  return ok({ enabled: workerEnabled() && process.env.BOOK_PDF_IMPORT_ENABLED === 'true', documents: data })
}

export async function POST(request: Request) {
  const auth = await bookTeacher()
  if (auth.response) return auth.response
  const parsed = bookUploadSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('학년도·교재·분권과 PDF 파일을 확인해주세요.')
  const p = parsed.data, book = getBook(p.bookCode)!
  if (!book.supported) return err(`${book.label}는 PDF 형식 확인 전입니다. 아직 등록할 수 없습니다.`, 422)
  const hint = bookFileHints(p.fileName)
  if (hint.code && hint.code !== p.bookCode) return err('선택한 교재와 파일명의 교재가 다릅니다. 파일을 확인해주세요.', 422)
  if (!workerEnabled() || process.env.BOOK_PDF_IMPORT_ENABLED !== 'true') return err('교재 PDF 워커 설정이 완료되지 않았습니다.', 503)
  if (!p.storagePath.startsWith(`${auth.user!.id}/`) || p.storagePath.includes('..')) return err('업로드 파일 경로가 올바르지 않습니다.', 403)
  const client = createServiceClient()
  // Hash the actual owned object, never a client-supplied hash. No model calls or rendering here.
  const download = await client.storage.from('exam-pdf-temp').download(p.storagePath)
  if (download.error || !download.data) return err('업로드한 PDF를 읽지 못했습니다.', 400)
  if (download.data.size > 50 * 1024 * 1024) return err('교재 PDF는 50MB 이하로 올려주세요.', 413)
  const bytes = Buffer.from(await download.data.arrayBuffer())
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return err('올바른 PDF 파일이 아닙니다.', 422)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const reserved = await client.rpc('book_pdf_reserve', { p_teacher: auth.teacherId, p_hash: hash, p_code: p.bookCode, p_year: p.academicYear, p_volume: p.volume })
  if (reserved.error || !reserved.data) return err('교재 분류 DB 설정을 확인해주세요.', 503)
  const doc = reserved.data as BookDocument & { reused: boolean }
  async function previousJob() {
    const result = await client.from('pdf_import_job').select('id,status').eq('teacher_id', auth.teacherId!).eq('kind', 'bank_book')
      .eq('target_id', doc.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (result.error) throw new Error('기존 등록 작업을 확인하지 못했습니다.')
    return result.data
  }
  async function reuse(job?: { id: string; status: string } | null) {
    await client.storage.from('exam-pdf-temp').remove([p.storagePath])
    return ok({ reused: true, document_id: doc.id, exam_id: doc.exam_bank_id, status: doc.status, job_id: job?.id })
  }
  try {
    const prior = await previousJob()
    if (doc.reused && (doc.status !== 'processing' || doc.exam_bank_id || prior)) return await reuse(prior)
    const job = await registerPdfImport({ kind: 'bank_book', teacherId: auth.teacherId!, authId: auth.user!.id, targetId: doc.id,
      storagePath: p.storagePath, payload: { fileName: p.fileName, title: doc.title, mimeType: 'application/pdf', bookProcessing: 'batch-v1', bookCode: doc.book_code } })
    return ok({ ...job, document_id: job.target_id }, { status: 202 })
  } catch (error) {
    // Another tab can win the unique active-target reservation after our lookup.
    const prior = await previousJob().catch(() => null)
    if (prior) return await reuse(prior)
    // Keep an unprocessed reservation so the same file can safely reconnect it.
    return err(error instanceof Error ? error.message : '교재 작업 등록 실패', 503)
  }
}
