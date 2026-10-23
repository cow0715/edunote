// ── 타입 ──────────────────────────────────────────────────────────────────

export type ExamBank = {
  id: string
  title: string
  exam_year: number | null
  exam_month: number | null
  grade: number | null
  source: string
  form_type: string | null
  material_kind?: 'past_exam' | 'textbook'
  book_code?: import('@/lib/book-pdf/catalog').BookCode | null
  book_volume?: import('@/lib/book-pdf/catalog').BookVolume | null
  created_at: string
  exam_bank_question: { count: number }[]
}

export type ExamBankQuestion = {
  id: string
  exam_bank_id: string
  question_number: number
  question_type: string
  passage: string
  question_text: string
  choices: string[]
  answer: string
  raw_text: string
  difficulty: string | null
  points: number | null
  correct_rate: number | null
  choice_rates: number[] | null
  explanation_intent: string | null
  explanation_translation: string | null
  explanation_solution: string | null
  explanation_vocabulary: string | null
  source_key?: string | null
  source_label?: string | null
  source_group_key?: string | null
  source_pages?: number[]
  source_document_id?: string | null
  exam_bank?: {
    title: string
    exam_year: number | null
    exam_month: number | null
    grade: number | null
    source: string
    material_kind?: 'past_exam' | 'textbook'
  }
}

export type VocabSource = {
  year: number | null
  month: number | null
  grade: number | null
  source: string
  question_number: number
  question_numbers?: number[]
  source_title?: string
  source_label?: string
}

export type VocabCollection = {
  id: string
  title: string
  grade: number | null
  year_from: number | null
  year_to: number | null
  source_document_id?: string | null
  months: number[]
  item_count: number
  created_at: string
}

export type VocabCollectionItem = {
  id: string
  word: string
  meaning: string
  frequency: number
  topic: string
  synonyms: string[]
  antonyms: string[]
  similar_words: string[]
  sources: VocabSource[]
  sort_order: number
}

export type VocabCollectionDetail = VocabCollection & {
  items: VocabCollectionItem[]
}

export type GenerateVocabResult =
  | { duplicate: true; existing: VocabCollection }
  | { duplicate?: false; id: string; title: string; item_count: number }
