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

// Four appearances distinguish a recent review need, improvement and a retained strength.
const insightWeeks = [1, 2, 3, 4].map((number) => analysisWeek(`insight-${number}`, number, `2026-09-${String(number * 7).padStart(2, '0')}`))
const insightTypes = [
  { tag: analysisTag, total: 5, correct: [4, 3, 2, 1] },
  { tag: { ...analysisTag, id: 'claim', name: '주장' }, total: 4, correct: [1, 1, 3, 4] },
  { tag: { ...analysisTag, id: 'content', name: '내용 일치' }, total: 4, correct: [4, 4, 4, 4] },
]
export const insightFixture = analysisData(insightTypes.flatMap((type) => insightWeeks.flatMap((week, index) =>
  Array.from({ length: type.total }, (_, question) => {
    const result = analysisAnswer(`${type.tag.id}-${week.id}-${question}`, week.id, question < type.correct[index], [type.tag])
    result.exam_question!.question_number = insightTypes.slice(0, insightTypes.indexOf(type)).reduce((sum, item) => sum + item.total, 0) + question + 1
    return result
  }),
)), insightWeeks)

// Many types include clear review needs, stable results and insufficient evidence.
const manyTypeNames = ['빈칸 추론', '문장 삽입', '글의 순서', '어법', '어휘', '제목', '요지', '주장', '주제', '내용 일치', '내용 불일치', '세부 정보', '지시어', '연결어', '문장 완성', '요약문', '함축 의미', '심경', '목적', '도표', '실용문', '장문', '추론', '문맥 어휘']
export const manyTypesFixture = analysisData(manyTypeNames.flatMap((name, typeIndex) => {
  const tag = { ...analysisTag, id: `many-${typeIndex}`, name }
  const weeks = typeIndex >= 16 ? insightWeeks.slice(-1) : insightWeeks
  return weeks.flatMap((week, index) => Array.from({ length: typeIndex >= 16 ? 2 : 5 }, (_, question) => {
    const correctCount = typeIndex < 4 ? [4, 4, 1, 2][index]
      : typeIndex < 6 ? [3, 3, 3, 4][index] : typeIndex < 16 ? [4, 5, 5, 4][index] : 1
    const answer = analysisAnswer(`${tag.id}-${week.id}-${question}`, week.id, question < correctCount, [tag])
    answer.exam_question!.question_number = typeIndex * 5 + question + 1
    return answer
  }))
}), insightWeeks)
