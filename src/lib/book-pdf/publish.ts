import { storeSourceRegions } from '../source-image-storage'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseExamVocabulary } from '../exam-vocabulary'
import { bookProofMatches } from './proof'
import { bookExtractionSchema, type BookDocument, type BookDraftUnit } from './types'
import { bookPublishReady, validateBookUnit } from './validation'
import { validateNativeBookUnit } from './native-unit'

/** Shared by worker/API. RPC locks versions so only a complete book appears. */
export async function publishVerifiedBook(client: SupabaseClient, doc: BookDocument) {
  if (doc.status === 'published') {
    if (doc.exam_bank_id) await saveBookImages(client, doc, doc.exam_bank_id)
    return doc.exam_bank_id
  }
  if (doc.status !== 'review' || !doc.manifest || doc.manifest.errors.length) throw new Error('문서 경계 자동 검증이 완료되지 않았습니다.')
  const { data, error } = await client.from('book_pdf_unit').select('*').eq('document_id', doc.id).order('unit_order').limit(2000)
  if (error) throw new Error('자동 검증 결과 조회 실패')
  const units = (data ?? []) as BookDraftUnit[]
  const checked = units.map((u) => ({ ...u, validation: u.verification.protocol === 2
    ? validateNativeBookUnit(u.manifest, u.extraction) : validateBookUnit(u.manifest, u.extraction, true) }))
  if (!bookPublishReady(checked, doc.manifest.units.length, doc.metadata_reviewed)
    || !doc.source_sha256 || !units.every((u) => bookProofMatches(u) && u.verification.pdf_hash === doc.source_sha256)) throw new Error('자동 검증을 통과하지 못한 묶음이 있습니다.')
  const vocab = checked.flatMap((u) => {
    const ex = bookExtractionSchema.parse(u.extraction)
    return ex.questions.flatMap((q) => {
      const supplement = u.enrichment?.questions.find((s) => s.key === q.key)?.vocabulary ?? ''
      return parseExamVocabulary([ex.vocabulary, supplement].filter(Boolean).join('\n'), q.question_type, ex.passage).map((v) => ({ key: q.key, ...v }))
    })
  })
  const result = await client.rpc('book_pdf_publish', { p_document_id: doc.id, p_teacher_id: doc.teacher_id,
    p_expected_revision: doc.revision, p_versions: Object.fromEntries(units.map((u) => [u.unit_key, u.version])),
    p_hashes: Object.fromEntries(units.map((u) => [u.unit_key, u.verification.extraction_hash])), p_vocab: vocab })
  if (result.error) throw new Error('등록 중 자료가 변경됐거나 자동 검증이 유효하지 않습니다.')
  await saveBookImages(client, doc, result.data as string)
  return result.data as string
}

async function saveBookImages(client: SupabaseClient, doc: BookDocument, bank: string) {
  const {data: units,error} = await client.from('book_pdf_unit').select('verification').eq('document_id',doc.id)
  if(error) throw Error(error.message)
  const regions = (units ?? []).flatMap((u)=> (u.verification as BookDraftUnit['verification']).source_regions ?? [])
  if(!regions.length) return
  if(!doc.source_path) throw Error('교재 원본 PDF가 없습니다.')
  const {data:file,error:downloadError}=await client.storage.from('pdf-import-sources').download(doc.source_path)
  if(downloadError || !file) throw Error('교재 원본 이미지 저장을 위한 PDF 조회 실패')
  const pdf=Buffer.from(await file.arrayBuffer()).toString('base64')
  for(const key of new Set(regions.map((r)=>r.key))) {
    const images=await storeSourceRegions(client,pdf,`source-images/bank/${bank}/${encodeURIComponent(key)}`,regions.filter((r)=>r.key===key))
    const {error:saveError}=await client.from('exam_bank_question').update({source_images:images}).eq('exam_bank_id',bank).eq('source_key',key)
    if(saveError) throw Error(saveError.message)
  }
}
