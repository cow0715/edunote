import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PdfImportJob } from '@/lib/pdf-import/types'
import type { BookDraftUnit } from '@/lib/book-pdf/types'
import { document, draft, extraction, manifest, pdfBytes, verification } from '../fixtures/book-pdf'
import { nativeFixture } from '../fixtures/book-native'
import { bookFingerprint, bookSourceFingerprint } from '@/lib/book-pdf/proof'
import { NATIVE_RECOVERY_REVISION } from '@/lib/book-pdf/recovery-policy'
import { BookBatchPending } from '@/lib/book-pdf/batch-policy'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), warm: vi.fn(), read: vi.fn(), slice: vi.fn(), inventory: vi.fn(), publish: vi.fn() }))
vi.mock('@/lib/book-pdf/pdf', () => ({ readBookPages: mocks.read, bookPageSlice: mocks.slice }))
vi.mock('@/lib/book-pdf/inventory', () => ({ inventoryBook: mocks.inventory }))
vi.mock('@/lib/llm/ranged', () => ({ prewarmPdfCache: mocks.warm }))
vi.mock('@/lib/book-pdf/native-pipeline', () => ({ processNativeBookUnit: mocks.verify }))
vi.mock('@/lib/book-pdf/publish', () => ({ publishVerifiedBook: mocks.publish }))
import { importBookPdf } from '@/lib/book-pdf/worker'
function database(status = 'processing', completed = false, leaseLost = false) {
  const doc = { ...document(), status }, rows: BookDraftUnit[] = completed ? [draft()] : []
  const calls: {name: string; args: Record<string, unknown>}[] = []
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    if (leaseLost) return { error: { message: 'worker lease lost' } }
    if (!args.p_unit_key) doc.status = 'review'
    else Object.assign(rows.find((r) => r.unit_key === args.p_unit_key)!, { extraction: args.p_extraction, enrichment: args.p_enrichment, validation: args.p_validation, verification: args.p_verification,
      verified_version: (args.p_verification as {status: string}).status === 'passed' ? 1 : null })
    return { error: null }
  }, from(table: string) {
    const query = { select: () => query, eq: () => query,
      single: async () => ({ data: doc, error: null }),
      upsert: (records: {manifest: BookDraftUnit['manifest']}[]) => { if (!rows.length) rows.push({ ...draft(), manifest: records[0].manifest, extraction: null, verified_version: null, verification: { ...verification(), status: 'pending' } }); return query },
      update: (value: Record<string, unknown>) => { Object.assign(doc, value); return query },
      then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: table === 'book_pdf_unit' ? rows : null, error: null }).then(resolve),
    }
    return query
  } } as unknown as SupabaseClient
  return { client, calls, doc, rows }
}
const job = { id: 'job', target_id: 'doc', teacher_id: 'teacher', lease_token: 'lease', source_path: 'private/file', payload: {} } as unknown as PdfImportJob
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue([]); mocks.slice.mockResolvedValue('JVBERi0='); mocks.warm.mockResolvedValue({})
  mocks.inventory.mockReturnValue(manifest)
  mocks.verify.mockImplementation(async ({ unit }) => {
    const f = nativeFixture(), proof = { ...f.proof, source_hash: bookSourceFingerprint(unit), audit: { ...f.proof.audit!, pages: unit.pages,
      image_hashes: Object.fromEntries(unit.pages.map((p: number) => [p, 'a'.repeat(64)])) } }
    return { extraction, enrichment: f.enrichment, validation: draft().validation, verification: proof }
  })
  mocks.publish.mockResolvedValue('bank')
})
describe('automatic textbook worker', () => {
  it('holds a selected book that disagrees with its printed source before paid mapping', async () => {
    const { client, doc } = database()
    doc.book_code = 'suwan_english'
    expect(await importBookPdf(client, job, pdfBytes)).toMatchObject({ metadata_conflict: true, verification_unresolved: true })
    expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled()
  })
  it.each([
    ['suteuk_reading','upper','chapter'], ['suteuk_reading','lower','mini_test'],
    ['suwan_english','type','type'], ['suwan_english','practical','practical'],
  ] as const)('keeps source audit, supplement and publication for %s %s', async (code,volume,kind) => {
    const { client,doc,calls } = database()
    doc.book_code=code; doc.volume=volume
    const local=structuredClone(manifest);local.units[0].questions[0].source_kind=kind
    mocks.inventory.mockReturnValue(local)
    expect(await importBookPdf(client, job, pdfBytes)).toMatchObject({auto_published:true})
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(calls[0].args.p_verification).toMatchObject({status:'passed',protocol:2})
    expect(calls[0].args.p_enrichment).toMatchObject({status:'complete'})
    expect(mocks.warm).not.toHaveBeenCalled()
  })
  it('holds a selected academic-year conflict before mapping and preserves the selected metadata', async () => {
    const { client, doc, rows } = database()
    doc.book_code = 'suteuk_english'; doc.academic_year = 2026
    mocks.inventory.mockReturnValue({ ...manifest, printed_years: [2027] })
    expect(await importBookPdf(client, job, pdfBytes)).toMatchObject({ metadata_conflict: true, verification_unresolved: true })
    expect(doc.academic_year).toBe(2026); expect(rows).toHaveLength(0)
    expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('collects all pending units without moving the document to review or publishing partial work', async () => {
    mocks.inventory.mockReturnValue({ ...manifest, units: [manifest.units[0], { ...manifest.units[0], key: 'unit-2', order: 2 }] })
    mocks.verify.mockRejectedValue(new BookBatchPending())
    const { client, doc, calls } = database()
    expect(await importBookPdf(client, job, pdfBytes)).toMatchObject({ batch_waiting: true })
    expect(mocks.verify).toHaveBeenCalledTimes(2)
    expect(doc.status).toBe('processing')
    expect(calls).toHaveLength(0)
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('uses the native unit pipeline without warmup, stores source/supplement and publishes automatically', async () => {
    const { client, calls, doc } = database()
    expect(await importBookPdf(client, job, pdfBytes)).toMatchObject({ auto_published: true, exam_id: 'bank' })
    expect(mocks.warm).not.toHaveBeenCalled()
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    expect(calls[0].args.p_verification).toMatchObject({ status: 'passed' })
    expect(calls[0].args.p_enrichment).toMatchObject({ status: 'complete' })
    expect(mocks.slice).toHaveBeenCalledWith(pdfBytes, manifest.units[0].pages)
    expect(mocks.verify.mock.calls[0][0]).not.toHaveProperty('chapterFile')
    expect(mocks.publish).toHaveBeenCalledTimes(1)
    expect(doc.metadata_reviewed).toBe(true)
    expect(doc.academic_year).toBe(2027)
  })
  it('does not warm or send an entire chapter even when units share a chapter', async () => {
    mocks.inventory.mockReturnValue({ ...manifest, units: [manifest.units[0], { ...manifest.units[0], key: 'unit-2', order: 2 }] })
    mocks.verify.mockRejectedValue(new Error('unit failure'))
    await expect(importBookPdf(database().client, job, pdfBytes)).rejects.toThrow('unit failure')
    expect(mocks.warm).not.toHaveBeenCalled()
    expect(mocks.verify).toHaveBeenCalledTimes(2)
  })
  it('retains unresolved diagnostics instead of registering an incomplete book', async () => {
    mocks.verify.mockResolvedValue({ extraction, validation: draft().validation, verification: { ...verification(), status: 'unresolved', attempts: 3, issues: ['不一致'] } })
    expect(await importBookPdf(database().client, job, pdfBytes)).toMatchObject({ auto_published: false, unresolved_units: ['unit-1'] })
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('does not make paid calls for unsupported source boundaries', async () => {
    mocks.inventory.mockReturnValue({ ...manifest, errors: ['경계 불명'] })
    expect(await importBookPdf(database().client, job, pdfBytes)).toMatchObject({ inventory_errors: ['경계 불명'] })
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('resumes after a crash before publication using persisted proofs', async () => {
    expect(await importBookPdf(database('review', true).client, job, pdfBytes)).toMatchObject({ auto_published: true })
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.warm).not.toHaveBeenCalled()
    expect(mocks.publish).toHaveBeenCalled()
  })
  it('skips verified units after worker retry without repeating extraction', async () => {
    await importBookPdf(database('processing', true).client, job, pdfBytes)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.publish).toHaveBeenCalled()
  })
  it('propagates lease loss without publishing', async () => {
    await expect(importBookPdf(database('processing', false, true).client, job, pdfBytes)).rejects.toThrow('lease lost')
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('does not reset a completed quality-repair budget after another unit caused a worker restart', async () => {
    const db = database('processing', true)
    db.rows[0].verification = { ...verification(), status: 'unresolved', attempts: 3, issues: ['still different'] }
    db.rows[0].verified_version = null
    expect(await importBookPdf(db.client, job, pdfBytes)).toMatchObject({ verification_unresolved: true, auto_published: false })
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.warm).not.toHaveBeenCalled()
  })
  it('does not repeat exhausted native-image quality recovery after a platform retry', async () => {
    const db = database('processing', true), f = nativeFixture()
    db.rows[0].verification = { ...f.proof, recovery_revision: NATIVE_RECOVERY_REVISION, source_hash: bookSourceFingerprint(db.rows[0].manifest), status: 'unresolved', exhausted: true,
      extraction_hash: bookFingerprint(db.rows[0].extraction), issues: ['unreadable'] }
    db.rows[0].verified_version = null
    expect(await importBookPdf(db.client, job, pdfBytes)).toMatchObject({ verification_unresolved: true })
    expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('reopens a previous policy hold and reuses accepted source on a new recovery revision', async () => {
    const db = database('review', true), f = nativeFixture()
    db.rows[0].verification = { ...f.proof, status: 'unresolved', exhausted: true, recovery_revision: NATIVE_RECOVERY_REVISION - 1,
      source_hash: bookSourceFingerprint(db.rows[0].manifest), extraction_hash: bookFingerprint(db.rows[0].extraction) }
    db.rows[0].verified_version = null
    expect(await importBookPdf(db.client, job, pdfBytes)).toMatchObject({ auto_published: true })
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    expect(mocks.publish).toHaveBeenCalledTimes(1)
  })
  it('does not reopen a same-policy quality hold in review', async () => {
    const db = database('review', true), f = nativeFixture()
    db.rows[0].verification = { ...f.proof, status: 'unresolved', exhausted: true, recovery_revision: NATIVE_RECOVERY_REVISION }
    db.rows[0].verified_version = null
    expect(await importBookPdf(db.client, job, pdfBytes)).toMatchObject({ verification_unresolved: true, recovery_revision: NATIVE_RECOVERY_REVISION })
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})
