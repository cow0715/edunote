export type Week = {
  id: string; class_id: string; week_number: number; start_date: string | null
  vocab_total: number; reading_total: number; homework_total: number
}
export type WeekScore = {
  id: string; week_id: string
  reading_correct: number; vocab_correct: number | null; homework_done: number | null; memo: string | null
  vocab_retake_correct: number | null
}
export type ConceptTag = { id: string; name: string; category_id: string | null; category_name: string | null }
export type StudentAnswer = {
  id: string; week_score_id: string; is_correct: boolean
  student_answer: number | null; student_answer_text: string | null; ai_feedback: string | null
  exam_question: {
    id: string; week_id: string; question_number: number; sub_label: string | null
    exam_type: 'reading' | 'vocab' | null; question_style: string
    correct_answer: number | null; correct_answer_text: string | null
    explanation?: string | null; question_text?: string | null
    exam_question_tag: { concept_tag: ConceptTag | null }[]
  } | null
}
export type AttendanceRecord = { id: string; class_id: string; date: string; status: 'present' | 'late' | 'absent' }
export type VocabWord = {
  id: string; number: number; english_word: string
  correct_answer: string | null; synonyms: string[] | null; antonyms: string[] | null
}
export type VocabAnswer = {
  id: string; week_score_id: string; is_correct: boolean
  student_answer: string | null
  retake_answer: string | null; retake_is_correct: boolean | null
  vocab_word: VocabWord | null
}
export type ShareData = {
  student: { id: string; name: string; school: string | null; grade: string | null }
  classes: { id: string; name: string }[]
  weeks: Week[]; weekScores: WeekScore[]; studentAnswers: StudentAnswer[]
  vocabAnswers: VocabAnswer[]; attendance: AttendanceRecord[]
  classAverages: Record<string, { readingRate: number | null; vocabRate: number | null }>
}

export const CIRCLE_NUM = ['①', '②', '③', '④', '⑤']
export type TabId = 'home' | 'score' | 'analysis' | 'wrongnote'
