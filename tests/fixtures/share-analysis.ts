import type { ConceptTag, ShareData, StudentAnswer, Week } from '@/app/share/[token]/share-types'

export const analysisTag: ConceptTag = { id: 'blank', name: '빈칸 추론', category_id: 'reading', category_name: '독해 유형' }
export function analysisWeek(id: string, week_number = 1, start_date: string | null = null): Week {
  return { id, week_number, start_date, class_id: 'class', reading_total: 10, vocab_total: 0, homework_total: 0 }
}
export function analysisAnswer(id: string, weekId: string, correct: boolean, tags = [analysisTag]): StudentAnswer {
  return {
    id, week_score_id: `score-${weekId}`, is_correct: correct, student_answer: 1, student_answer_text: null, ai_feedback: null,
    exam_question: { id, week_id: weekId, question_number: 1, sub_label: null, exam_type: 'reading', question_style: 'objective',
      correct_answer: 2, correct_answer_text: null, exam_question_tag: tags.map((concept_tag) => ({ concept_tag })) },
  }
}
export function analysisData(answers: StudentAnswer[], weeks: Week[]): ShareData {
  return {
    student: { id: 'sample', name: '샘플 학생', school: null, grade: null }, classes: [], currentPeriod: null, periodOptions: [],
    weeks, studentAnswers: answers,
    weekScores: weeks.map((week) => ({ id: `score-${week.id}`, week_id: week.id, reading_correct: 0, vocab_correct: null, homework_done: null, memo: null, vocab_retake_correct: null })),
    vocabAnswers: [], vocabWords: [], attendance: [], clinicAttendance: [], classAverages: {},
  }
}
export const analysisFixture = analysisData([
  analysisAnswer('a', 'w1', false), analysisAnswer('b', 'w1', false),
  analysisAnswer('c', 'w2', false), analysisAnswer('d', 'w2', true), analysisAnswer('e', 'w2', true),
  analysisAnswer('f', 'w1', true, [{ ...analysisTag, id: 'claim', name: '주장' }]),
  analysisAnswer('g', 'w2', false, [{ ...analysisTag, id: 'claim', name: '주장' }]),
  analysisAnswer('h', 'w2', true, [{ ...analysisTag, id: 'content', name: '내용 일치' }]),
], [analysisWeek('w1', 1, '2026-09-17'), analysisWeek('w2', 2, '2026-09-24')])
