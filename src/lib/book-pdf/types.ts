import { z } from 'zod'
import type { MaterialSupplement } from '../llm/material-enrichment-contract'

export type BookUnderline = { page: number; side: 'left' | 'right'; text: string; context: string }
export type BookPage = { page: number; left: string; right: string; full: string; underlines?: BookUnderline[]; bold?: BookUnderline[] }
export type BookQuestionRef = { key: string; chapter: number; section: 'gateway' | 'exercise'; number: number; label: string; label_page: number; printed_answer: number | null }
export type BookUnitManifest = { key: string; order: number; pages: number[]; questions: BookQuestionRef[]; left_text: string; right_text: string; translation: string; visual_required: boolean; underlines?: BookUnderline[]; bold?: BookUnderline[] }
export type BookManifest = { version: 1; page_count: number; ignored_pages: number[]; printed_years: number[]; filename_year: number | null; question_count: number; units: BookUnitManifest[]; errors: string[]; warnings: string[] }
export type BookValidation = { errors: string[]; warnings: string[]; english_coverage: number; translation_coverage: number }

const text = z.string().max(80_000)
export const bookExtractionSchema = z.object({
  passage: text,
  translation: text,
  vocabulary: z.string().max(20_000),
  questions: z.array(z.object({
    key: z.string().max(100), question_type: z.string().min(1).max(80), stem: z.string().max(20_000),
    choices: z.array(z.string().max(8_000)).max(10), answer: z.number().int().min(1).max(5),
    intent: z.string().max(4_000), solution: text,
  }).strict()).min(1).max(20),
}).strict()
export type BookExtraction = z.infer<typeof bookExtractionSchema>
export const bookBlindCheckSchema = z.object({
  extraction: bookExtractionSchema,
  checks: z.object({ boundaries: z.boolean(), legibility: z.boolean(), formatting: z.boolean(), visual_reference: z.boolean() }).strict(),
  issues: z.array(z.string().min(1).max(2000)).max(30),
}).strict()
export type BookBlindCheck = z.infer<typeof bookBlindCheckSchema>
export type BookVerification = {
  protocol: 1 | 2; status: 'pending' | 'passed' | 'unresolved'; attempts: number; models: string[]; issues: string[];
  source_hash: string; pdf_hash: string; extraction_hash: string | null; checks: BookBlindCheck['checks'] | null
  pipeline?: 'native-image-v1'; exhausted?: boolean; enrichment_hash?: string;
  audit?: { pages: number[]; image_hashes: Record<string, string>; native_hash: string; mapping_hash: string;
    rounds: number; last_status: 'pass' | 'repair' | 'unreadable'; extraction_hash: string }
}
export type BookEnrichment = MaterialSupplement & { protocol: 1; status: 'complete'; source_hash: string; model: string }
export type BookDraftUnit = { document_id: string; unit_key: string; unit_order: number; manifest: BookUnitManifest; extraction: BookExtraction | null; enrichment?: BookEnrichment | null; validation: BookValidation; version: number; reviewed_version: number | null; reviewed_at: string | null; verified_version: number | null; verification: BookVerification }
export type BookDocumentManifest = Omit<BookManifest, 'units'> & { units: Pick<BookUnitManifest, 'key' | 'order' | 'pages' | 'questions'>[] }
export type BookDocument = { id: string; teacher_id: string; title: string; academic_year: number | null; metadata_reviewed: boolean; revision: number; status: 'processing' | 'review' | 'published'; source_path: string | null; source_sha256?: string | null; manifest: BookDocumentManifest | null; exam_bank_id: string | null; created_at: string }
