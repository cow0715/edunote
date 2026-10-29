import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createCallLimiter, getPdfWorkerContext, reportPdfStage } from '../pdf-import/context'
import type { PdfImportJob } from '../pdf-import/types'
import { inventoryBook } from './inventory'
import { bookPageSlice, readBookPages } from './pdf'
import { bookFingerprint, bookProofMatches, bookSourceFingerprint } from './proof'
import { publishVerifiedBook } from './publish'
import type { BookDocument, BookDraftUnit } from './types'
import { processNativeBookUnit, type NativeBookResult } from './native-pipeline'
import { NATIVE_RECOVERY_REVISION, needsUpdatedNativeRecovery } from './recovery-policy'
import { BookBatchPending } from './batch-policy'
import { classificationConflict, sourceClassificationConflict, getBook } from './catalog'

export async function importBookPdf(client: SupabaseClient, job: PdfImportJob, bytes: Uint8Array) {
  const pdfHash = createHash('sha256').update(bytes).digest('hex')
  async function stage(unit: NativeBookResult | null, unitKey: string | null) {
    const { error } = await client.rpc('book_pdf_stage', { p_job_id: job.id, p_token: job.lease_token,
      p_unit_key: unitKey, p_extraction: unit?.extraction ?? null, p_validation: unit?.validation ?? null, p_verification: unit?.verification ?? null,
      p_enrichment: unit?.enrichment ?? null })
    if (error) throw new Error(error.message)
  }
  async function currentDocument() {
    const { data, error } = await client.from('book_pdf_document').select('*').eq('id', job.target_id).eq('teacher_id', job.teacher_id).single()
    if (error || !data) throw new Error('교재 자료를 찾을 수 없습니다.')
    return data as BookDocument
  }
  const document = await currentDocument()
  if (document.source_sha256 && document.source_sha256 !== pdfHash) throw new Error('원본 PDF 해시가 등록 당시와 다릅니다.')
  if (document.status === 'published') return { document_id: document.id, exam_id: await publishVerifiedBook(client, document), auto_published: true }
  if (document.book_code && !getBook(document.book_code)?.supported) {
    return { document_id: document.id, auto_published: false, verification_unresolved: true, inventory_errors: ['선택한 교재는 PDF 형식 확인 전입니다.'], recovery_revision: NATIVE_RECOVERY_REVISION }
  }
  if (document.status === 'review') {
    // Resume a crash after staging but before publication without paid reparse.
    const { data, error } = await client.from('book_pdf_unit').select('*').eq('document_id', document.id)
    if (error) throw new Error(error.message)
    if (document.manifest && !document.manifest.errors.length && data?.length === document.manifest.units.length && data.every((u) => bookProofMatches(u as BookDraftUnit))) {
      return { document_id: document.id, exam_id: await publishVerifiedBook(client, document), auto_published: true }
    }
    if (document.manifest && !document.manifest.errors.length && data?.some((u) => needsUpdatedNativeRecovery((u as BookDraftUnit).verification))) {
      // Keep accepted units and checkpoints; only a new deployed policy may
      // reopen an exhausted hold. A same-version restart keeps its budget.
      const resumed = await client.from('book_pdf_document').update({ status: 'processing' }).eq('id', document.id).eq('status', 'review')
      if (resumed.error) throw new Error(resumed.error.message)
    } else return { document_id: document.id, auto_published: false, verification_unresolved: true, recovery_revision: NATIVE_RECOVERY_REVISION }
  }
  await reportPdfStage('원문 문항·정답·연결 페이지를 조사하는 중')
  const manifest = inventoryBook(await readBookPages(bytes), String(job.payload.fileName ?? ''))
  const metadataError = classificationConflict(document, manifest.printed_years)
    ?? sourceClassificationConflict(document, manifest.units.flatMap((unit) => unit.questions))
  const saved = await client.from('book_pdf_document').update({ source_path: job.source_path,
    source_sha256: pdfHash, academic_year: document.book_code ? document.academic_year : manifest.printed_years.length === 1 ? manifest.printed_years[0] : null,
    metadata_reviewed: !metadataError, manifest: { ...manifest, ...(metadataError ? { classification_error: metadataError } : {}), units: manifest.units.map(({ key, order, pages, questions }) => ({ key, order, pages, questions })) } })
    .eq('id', job.target_id).eq('status', 'processing')
  if (saved.error) throw new Error(saved.error.message)
  if (metadataError) {
    await stage(null, null)
    return { document_id: job.target_id, auto_published: false, metadata_conflict: true, inventory_errors: [metadataError], verification_unresolved: true, recovery_revision: NATIVE_RECOVERY_REVISION }
  }
  if (manifest.errors.length) {
    await stage(null, null)
    return { document_id: job.target_id, auto_published: false, inventory_errors: manifest.errors, verification_unresolved: true, recovery_revision: NATIVE_RECOVERY_REVISION }
  }
  const inserted = await client.from('book_pdf_unit').upsert(manifest.units.map((m) => ({ document_id: job.target_id,
    unit_key: m.key, unit_order: m.order, manifest: m })), { onConflict: 'document_id,unit_key', ignoreDuplicates: true })
  if (inserted.error) throw new Error(inserted.error.message)
  const existing = await client.from('book_pdf_unit').select('*').eq('document_id', job.target_id)
  if (existing.error) throw new Error(existing.error.message)
  const previous = new Map((existing.data as BookDraftUnit[]).map((u) => [u.unit_key, u]))
  const pending = manifest.units.filter((unit) => {
    const old = previous.get(unit.key)
    if (old && bookProofMatches(old) && old.verification.pdf_hash === pdfHash) return false
    // A restart for another unit's network failure must not reset this unit's
    // exhausted repair budget or pay to replay its rejected candidates again.
    if (old?.verification?.status === 'unresolved' && !needsUpdatedNativeRecovery(old.verification) && (old.verification.protocol === 2 ? old.verification.exhausted : old.verification.attempts >= 3)
      && old.verification.pdf_hash === pdfHash && old.verification.source_hash === bookSourceFingerprint(unit)
      && old.verification.extraction_hash === (old.extraction ? bookFingerprint(old.extraction) : null)) return false
    return true
  })
  // Bound both native parsing and rasterization, not just paid API calls.
  const unitLimit = createCallLimiter(Math.min(2, getPdfWorkerContext()?.concurrency ?? 2))
  const settled = await Promise.allSettled(pending.map((unit) => unitLimit(async () => {
    getPdfWorkerContext()?.signal.throwIfAborted()
    const smallPdf = await bookPageSlice(bytes, unit.pages)
    const verified = await processNativeBookUnit({ unit, pdfHash, bytes: new Uint8Array(Buffer.from(smallPdf, 'base64')) })
    await stage(verified, unit.key)
  })))
  const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  const fatal = failures.find((r) => !(r.reason instanceof BookBatchPending))
  if (fatal) throw fatal.reason
  if (failures.length) return { document_id: job.target_id, batch_waiting: true }
  await reportPdfStage('검증 결과를 확정하고 문제은행에 등록하는 중')
  await stage(null, null)
  const finished = await currentDocument()
  const { data: final, error } = await client.from('book_pdf_unit').select('*').eq('document_id', job.target_id)
  if (error) throw new Error(error.message)
  const unresolved = (final as BookDraftUnit[]).filter((u) => !bookProofMatches(u))
  if (unresolved.length) return { document_id: job.target_id, auto_published: false, verification_unresolved: true,
    unresolved_units: unresolved.map((u) => u.unit_key), question_count: manifest.question_count, unit_count: manifest.units.length, recovery_revision: NATIVE_RECOVERY_REVISION }
  return { document_id: job.target_id, exam_id: await publishVerifiedBook(client, finished), auto_published: true,
    question_count: manifest.question_count, unit_count: manifest.units.length }
}
