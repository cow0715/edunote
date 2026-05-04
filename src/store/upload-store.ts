import { create } from 'zustand'

// ── 해설지 업로드 상태 ────────────────────────────────────────────────────────
export type AnswerSheetStatus =
  | { type: 'idle' }
  | { type: 'loading'; step: string }
  | { type: 'done'; questions_parsed: number; students_regraded: number; subjective_grading_failed?: boolean }
  | { type: 'error'; message: string }

// ── 단어 세팅 상태 ────────────────────────────────────────────────────────────
export type VocabEntry = {
  number: number
  passage_label?: string | null
  english_word: string
  part_of_speech?: string | null
  correct_answer: string | null
  synonyms: string[]
  antonyms: string[]
  derivatives?: string | null
  source_row_index?: number | null
  example_sentence?: string | null
  example_translation?: string | null
  example_source?: string | null
}

export type VocabSetupStatus =
  | { type: 'idle' }
  | { type: 'file-selected'; fileName: string }
  | { type: 'loading'; step: string }
  | { type: 'saving' }
  | { type: 'ready'; savedCount: number }
  | { type: 'error'; message: string }

type VocabState = {
  status: VocabSetupStatus
  savedWords: VocabEntry[]  // 마지막 저장본 (재마운트 시 초기값용)
}

// ── 스토어 ────────────────────────────────────────────────────────────────────
type UploadStore = {
  answerSheet: Record<string, AnswerSheetStatus>
  vocab: Record<string, VocabState>

  setAnswerSheet: (weekId: string, status: AnswerSheetStatus) => void
  setVocabStatus: (weekId: string, status: VocabSetupStatus) => void
  setVocabSaved: (weekId: string, savedWords: VocabEntry[], status: VocabSetupStatus) => void
}

export const useUploadStore = create<UploadStore>((set) => ({
  answerSheet: {},
  vocab: {},

  setAnswerSheet: (weekId, status) =>
    set((s) => ({ answerSheet: { ...s.answerSheet, [weekId]: status } })),

  setVocabStatus: (weekId, status) =>
    set((s) => ({
      vocab: { ...s.vocab, [weekId]: { ...s.vocab[weekId], status } },
    })),

  setVocabSaved: (weekId, savedWords, status) =>
    set((s) => ({
      vocab: { ...s.vocab, [weekId]: { savedWords, status } },
    })),
}))
