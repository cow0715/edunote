// ── 타입 ──────────────────────────────────────────────────────────────────

export type ExamBank = {
  id: string
  title: string
  exam_year: number
  exam_month: number
  grade: number
  source: string
  form_type: string
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
  exam_bank?: {
    title: string
    exam_year: number
    exam_month: number
    grade: number
    source: string
  }
}

export type VocabSource = {
  year: number
  month: number
  grade: number
  source: string
  question_number: number
  question_numbers?: number[]
}

export type VocabCollection = {
  id: string
  title: string
  grade: number
  year_from: number
  year_to: number
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
