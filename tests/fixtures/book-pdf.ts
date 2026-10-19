import { createHash } from 'node:crypto'
import { bookFingerprint, bookSourceFingerprint } from '@/lib/book-pdf/proof'
import type { BookDocument, BookDraftUnit, BookExtraction, BookManifest, BookVerification } from '@/lib/book-pdf/types'
export const pdfBytes = new Uint8Array([1])
export const pdfHash = createHash('sha256').update(pdfBytes).digest('hex')
export const extraction: BookExtraction = { passage: 'Every source sentence must be kept completely intact.', translation: '원문 해석입니다.', vocabulary: 'source 원문',
  questions: [{ key: '1:exercise:1', question_type: 'topic', stem: '발문', choices: ['①a', '②b', '③c', '④d', '⑤e'], answer: 2, intent: '원문 소재', solution: '원문 해설' }] }
export const manifest: BookManifest = { version: 1, page_count: 2, ignored_pages: [], printed_years: [2027], filename_year: 2026, question_count: 1, warnings: [], errors: [],
  units: [{ key: 'unit-1', order: 1, pages: [1, 2], left_text: `[수능특강(영어) 1강 1번]\n발문\n${extraction.passage}\n${extraction.questions[0].choices.join('\n')}`,
    right_text: '[정답]②\n[소재]원문 소재\n[해석]원문 해석입니다.\n[해설]원문 해설\n[어휘]source 원문', translation: extraction.translation, visual_required: false,
    questions: [{ key: '1:exercise:1', chapter: 1, section: 'exercise', number: 1, label: '1강 1번', label_page: 2, printed_answer: 2 }] }] }
export const checks = { boundaries: true, legibility: true, formatting: true, visual_reference: true }
export function verification(value = extraction): BookVerification { return { protocol: 1, status: 'passed', attempts: 1, models: ['extractor', 'verifier'], issues: [], checks,
  source_hash: bookSourceFingerprint(manifest.units[0]), pdf_hash: pdfHash, extraction_hash: bookFingerprint(value) } }
export function draft(): BookDraftUnit { return { document_id: 'doc', unit_key: 'unit-1', unit_order: 1, version: 1, reviewed_version: null, reviewed_at: null,
  verified_version: 1, verification: verification(), extraction: structuredClone(extraction), manifest: structuredClone(manifest.units[0]),
  validation: { errors: [], warnings: [], english_coverage: 1, translation_coverage: 1 } } }
export function document(): BookDocument { return { id: 'doc', teacher_id: 'teacher', title: '교재', academic_year: 2027, metadata_reviewed: true, revision: 5, status: 'review',
  source_path: 'private/file.pdf', source_sha256: pdfHash, manifest: structuredClone(manifest), exam_bank_id: null, created_at: '' } }
