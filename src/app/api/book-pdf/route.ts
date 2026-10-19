import { randomUUID } from 'node:crypto'
import { ok, err } from '@/lib/api'
import { bookTeacher } from '@/lib/book-pdf/server'
import { createServiceClient } from '@/lib/supabase/service'
import { registerPdfImport } from '@/lib/pdf-import/server'
import { workerEnabled } from '@/lib/pdf-import/types'
import { z } from 'zod'

export async function GET() {
  const auth = await bookTeacher()
  if (auth.response) return auth.response
  const { data, error } = await auth.supabase!.from('book_pdf_document')
    .select('id,title,academic_year,status,exam_bank_id,created_at').eq('teacher_id', auth.teacherId!).order('created_at', { ascending: false }).limit(100)
  if (error) return err('교재 검토 DB 설정이 필요합니다.', 503)
  return ok({ enabled: workerEnabled() && process.env.BOOK_PDF_IMPORT_ENABLED === 'true', documents: data })
}

const uploadSchema = z.object({ title: z.string().trim().min(1).max(300), fileName: z.string().max(500), storagePath: z.string().min(1).max(1000) })
export async function POST(request: Request) {
  const auth = await bookTeacher()
  if (auth.response) return auth.response
  if (!workerEnabled() || process.env.BOOK_PDF_IMPORT_ENABLED !== 'true') return err('교재 PDF 워커 설정이 완료되지 않았습니다.', 503)
  const parsed = uploadSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('제목과 PDF 파일을 확인해주세요.')
  const client = createServiceClient(), id = randomUUID()
  const { error } = await client.from('book_pdf_document').insert({ id, teacher_id: auth.teacherId, title: parsed.data.title })
  if (error) return err('교재 검토 DB 설정을 확인해주세요.', 503)
  try {
    const job = await registerPdfImport({ kind: 'bank_book', teacherId: auth.teacherId!, authId: auth.user!.id, targetId: id,
      storagePath: parsed.data.storagePath, payload: { fileName: parsed.data.fileName, mimeType: 'application/pdf' } })
    // A retry of the same upload may already target a different reserved draft.
    if (job.target_id !== id) await client.from('book_pdf_document').delete().eq('id', id).eq('status', 'processing')
    return ok({ ...job, document_id: job.target_id }, { status: 202 })
  } catch (e) {
    await client.from('book_pdf_document').delete().eq('id', id).eq('status', 'processing')
    return err(e instanceof Error ? e.message : '교재 작업 등록 실패', 503)
  }
}
