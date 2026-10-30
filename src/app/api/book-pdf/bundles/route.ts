import { createHash, randomUUID } from 'node:crypto'
import { ok, err } from '@/lib/api'
import { bookTeacher } from '@/lib/book-pdf/server'
import { createServiceClient } from '@/lib/supabase/service'
import { registerPdfImport } from '@/lib/pdf-import/server'
import { dispatchPdfJob } from '@/lib/pdf-import/gcp'
import { workerEnabled } from '@/lib/pdf-import/types'
import { bookBundleSchema } from '@/lib/book-pdf/registration-schema'
import { bookSelectionIssue } from '@/lib/book-pdf/registration-selection'
import { BOOK_PROFILE_VERSION } from '@/lib/book-pdf/profiles'
import type { BookDocument } from '@/lib/book-pdf/types'

export async function GET() {
  const auth = await bookTeacher(); if (auth.response) return auth.response
  const { data, error } = await createServiceClient().rpc('book_pdf_bundle_read', { p_teacher: auth.teacherId })
  if (error) return err('묶음 등록 SQL 적용이 필요합니다.', 503)
  return ok({ bundles: data ?? [] })
}
export async function POST(request: Request) {
  const auth = await bookTeacher(); if (auth.response) return auth.response
  const parsed = bookBundleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('교재 PDF는 한 묶음에 1~4개를 선택하고 파일별 분류를 확인해주세요.')
  if (!workerEnabled() || process.env.BOOK_PDF_IMPORT_ENABLED !== 'true') return err('교재 워커 설정이 필요합니다.', 503)
  const { files, requestKey } = parsed.data, teacher = auth.teacherId!, user = auth.user!.id
  for (const file of files) {
    const issue = bookSelectionIssue(file, file.fileName)
    if (issue || file.bookCode === 'suteuk_english' || !file.storagePath.startsWith(`${user}/`) || file.storagePath.includes('..')) return err(issue || '묶음 등록은 확인한 영독·수완 PDF와 본인 업로드만 지원합니다.', 422)
  }
  if (new Set(files.map(f => f.storagePath)).size !== files.length) return err('같은 업로드 파일이 중복 선택됐습니다.', 422)
  const db = createServiceClient(), token = randomUUID()
  async function dispatchReady(id: string) {
    const attached = await db.from('book_pdf_bundle_file').select('job_id').eq('bundle_id', id)
    if (attached.error) throw Error('접수된 작업 조회 실패')
    for (const item of attached.data ?? []) if (item.job_id) {
      const job = await db.from('pdf_import_job').select('status,payload').eq('id', item.job_id).single()
      if (job.data?.status === 'queued' && job.data.payload?.bundleId === id) {
        try { await dispatchPdfJob(item.job_id, 'bank_book') } catch { /* durable queued job remains visible */ }
      }
    }
  }
  let bundleId: string | undefined
  try {
    const opened = await db.rpc('book_pdf_bundle_open', { p_teacher: teacher, p_key: requestKey, p_files: files, p_token: token })
    if (opened.error || !opened.data) throw Error(opened.error?.message || '묶음 등록 SQL을 확인해주세요.')
    bundleId = opened.data.id
    if (opened.data.ready) { await dispatchReady(bundleId!); return ok({ bundle_id: bundleId, reused: true }) }
    const existing = await db.from('book_pdf_bundle_file').select('position,document_id,job_id').eq('bundle_id', bundleId!)
    if (existing.error) throw Error('접수 진행 기록을 읽지 못했습니다.')
    for (const [position, file] of files.entries()) {
      const previous = existing.data?.find(x => x.position === position)
      let document: BookDocument | null = null
      if (previous) {
        const saved = await db.from('book_pdf_document').select('*').eq('id', previous.document_id).eq('teacher_id', teacher).single()
        if (saved.error || !saved.data) throw Error('기존 교재를 읽지 못했습니다.')
        document = saved.data
      } else {
        const download = await db.storage.from('exam-pdf-temp').download(file.storagePath)
        if (download.error || !download.data || download.data.size > 50*1024*1024) throw Error(`${file.fileName}: 업로드 PDF를 읽지 못했거나 50MB를 넘습니다.`)
        const bytes = Buffer.from(await download.data.arrayBuffer())
        if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw Error('올바른 PDF 파일이 아닙니다.')
        const reserved = await db.rpc('book_pdf_reserve', { p_teacher: teacher, p_hash: createHash('sha256').update(bytes).digest('hex'), p_code: file.bookCode, p_year: file.academicYear, p_volume: file.volume })
        if (reserved.error || !reserved.data) throw Error(reserved.error?.message || '교재 예약 실패')
        document = reserved.data as BookDocument
        if (document.book_code !== file.bookCode || document.volume !== file.volume || document.academic_year !== file.academicYear) throw Error('동일 파일의 기존 교재 분류가 다릅니다. 기존 자료에서 분류를 확인해주세요.')
        const attached = await db.rpc('book_pdf_bundle_attach', { p_bundle: bundleId, p_token: token, p_position: position, p_document: document.id })
        if (attached.error) throw Error(attached.error.message)
      }
      const prior = await db.from('pdf_import_job').select('id,status').eq('teacher_id', teacher).eq('kind', 'bank_book').eq('target_id', document!.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (prior.error) throw Error('기존 작업 확인 실패')
      let jobId = prior.data?.id ?? null
      // Connecting a failed/held existing job is deliberately read-only: it does
      // not queue it, change its protocol, clear its budget or resume processing.
      if (!jobId && document!.status !== 'published') {
        const job = await registerPdfImport({ kind: 'bank_book', teacherId: teacher, authId: user, targetId: document!.id,
          storagePath: file.storagePath, deferDispatch: true, payload: { fileName: file.fileName, title: document!.title,
            bookProcessing: 'batch-v1', bookProfile: BOOK_PROFILE_VERSION, bundleId } })
        jobId = job.job_id
      }
      const attached = await db.rpc('book_pdf_bundle_attach', { p_bundle: bundleId, p_token: token, p_position: position, p_document: document!.id, p_job: jobId })
      if (attached.error) throw Error(attached.error.message)
      if (prior.data || document!.status === 'published') await db.storage.from('exam-pdf-temp').remove([file.storagePath])
    }
    const sealed = await db.rpc('book_pdf_bundle_seal', { p_bundle: bundleId, p_token: token })
    if (sealed.error) throw Error(sealed.error.message)
    await dispatchReady(bundleId!)
    return ok({ bundle_id: bundleId, accepted: true }, { status: 202 })
  } catch (error) {
    if (bundleId) await db.from('book_pdf_bundle').update({ register_until: null }).eq('id', bundleId).eq('register_token', token).eq('state', 'preparing')
    return err(error instanceof Error ? error.message : '묶음 접수 실패', 503)
  }
}
