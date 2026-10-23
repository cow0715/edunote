import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { publicPdfJob } from '@/lib/pdf-import/server'
import type { PdfImportJob } from '@/lib/pdf-import/types'
import { bookProgress } from '@/lib/book-pdf/progress'
import { reconcileExamStorage } from '@/lib/pdf-import/exam-storage-audit-server'

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 403)
  const weekId = new URL(request.url).searchParams.get('weekId')
  let query = supabase.from('pdf_import_job').select('*').eq('teacher_id', teacherId)
  query = weekId ? query.eq('kind', 'week_answers').eq('target_id', weekId) : query.neq('kind', 'week_answers')
  const { data, error } = await query.order('created_at', { ascending: false }).limit(30)
  if (error) return err('작업 목록을 읽지 못했습니다. 워커 DB 마이그레이션을 확인해주세요.', 503)
  const jobs = data as PdfImportJob[]
  if (weekId || !jobs.length) return ok(jobs.map(publicPdfJob))
  const bookIds = jobs.filter((job) => job.kind === 'bank_book').map((job) => job.target_id)
  const bankIds = jobs.filter((job) => job.kind !== 'bank_book').map((job) => job.target_id)
  const [documents, banks, units] = await Promise.all([
    bookIds.length ? supabase.from('book_pdf_document').select('id,title,manifest').eq('teacher_id', teacherId).in('id', bookIds) : { data: [], error: null },
    bankIds.length ? supabase.from('exam_bank').select('id,title').eq('teacher_id', teacherId).in('id', bankIds) : { data: [], error: null },
    bookIds.length ? supabase.from('book_pdf_progress').select('document_id,completed').in('document_id', bookIds) : { data: [], error: null },
  ])
  if (documents.error || banks.error || units.error) return err('자료별 처리 상태를 읽지 못했습니다.', 503)
  const reconciled = await reconcileExamStorage(supabase, teacherId, jobs)
  return ok(reconciled.map((job) => {
    const doc = documents.data?.find((d) => d.id === job.target_id)
    return { ...publicPdfJob(job), display_title: doc?.title ?? banks.data?.find((b) => b.id === job.target_id)?.title ?? String(job.payload.title ?? job.payload.fileName ?? ''),
      ...(doc ? { progress: bookProgress(doc.manifest, units.data?.find((u) => u.document_id === doc.id)?.completed ?? 0) } : {}) }
  }))
}
