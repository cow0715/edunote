import { describe, expect, it } from 'vitest'
import {
  buildDefaultMockExamQuestions,
  calculateMockExamScore,
  getDefaultMockExamPoints,
  getDefaultMockExamQuestionType,
  getDefaultMockExamSection,
  getEnglishAbsoluteGrade,
  isMockAnswerCorrect,
  normalizeAnswer,
  type MockExamQuestionForGrading,
} from '@/lib/mock-exam'

function question(over: Partial<MockExamQuestionForGrading> = {}): MockExamQuestionForGrading {
  return {
    id: 'q',
    question_number: 1,
    correct_answer: '1',
    points: 2,
    section: 'listening',
    question_type: '듣기',
    is_void: false,
    all_correct: false,
    extra_correct_answers: [],
    ...over,
  }
}

describe('normalizeAnswer', () => {
  it('null/undefined는 빈 문자열', () => {
    expect(normalizeAnswer(null)).toBe('')
    expect(normalizeAnswer(undefined)).toBe('')
  })

  it('원문자를 숫자로 바꾼다', () => {
    expect(normalizeAnswer('①')).toBe('1')
    expect(normalizeAnswer('⑤')).toBe('5')
  })

  it('전각 숫자를 반각으로 바꾼다', () => {
    expect(normalizeAnswer('１')).toBe('1')
    expect(normalizeAnswer('５')).toBe('5')
  })

  it('공백을 모두 제거한다', () => {
    expect(normalizeAnswer('  ③  ')).toBe('3')
    expect(normalizeAnswer('1 2')).toBe('12')
  })

  it('소문자로 통일한다', () => {
    expect(normalizeAnswer(' A ')).toBe('a')
  })
})

describe('isMockAnswerCorrect', () => {
  it('원문자와 숫자를 같은 답으로 본다', () => {
    expect(isMockAnswerCorrect('①', '1')).toBe(true)
  })

  it('빈 답은 항상 오답', () => {
    expect(isMockAnswerCorrect('', '1')).toBe(false)
    expect(isMockAnswerCorrect(null, '1')).toBe(false)
  })

  it('복수정답(extra_correct_answers)을 인정한다', () => {
    expect(isMockAnswerCorrect('2', '1', ['2'])).toBe(true)
  })

  it('복수정답 목록에도 없으면 오답', () => {
    expect(isMockAnswerCorrect('3', '1', ['2'])).toBe(false)
  })
})

describe('getEnglishAbsoluteGrade — 절대평가 등급컷 경계', () => {
  it('컷 정확히 걸치면 해당 등급', () => {
    expect(getEnglishAbsoluteGrade(90)).toBe(1)
    expect(getEnglishAbsoluteGrade(80)).toBe(2)
    expect(getEnglishAbsoluteGrade(20)).toBe(8)
  })

  it('컷보다 1점 낮으면 다음 등급', () => {
    expect(getEnglishAbsoluteGrade(89)).toBe(2)
    expect(getEnglishAbsoluteGrade(79)).toBe(3)
  })

  it('최하 컷 미만은 9등급', () => {
    expect(getEnglishAbsoluteGrade(19)).toBe(9)
    expect(getEnglishAbsoluteGrade(0)).toBe(9)
  })

  it('점수가 null이면 등급도 null', () => {
    expect(getEnglishAbsoluteGrade(null)).toBeNull()
    expect(getEnglishAbsoluteGrade(undefined)).toBeNull()
  })

  it('커스텀 컷오프를 적용한다', () => {
    expect(getEnglishAbsoluteGrade(90, { 1: 95, 2: 85 })).toBe(2)
    expect(getEnglishAbsoluteGrade(96, { 1: 95, 2: 85 })).toBe(1)
  })

  it('컷오프가 null이면 기본 컷으로 되돌아간다', () => {
    expect(getEnglishAbsoluteGrade(90, null)).toBe(1)
  })
})

describe('문항 번호 → 기본 배점/영역/유형', () => {
  it('3점 문항 집합', () => {
    expect(getDefaultMockExamPoints(21)).toBe(3)
    expect(getDefaultMockExamPoints(39)).toBe(3)
    expect(getDefaultMockExamPoints(22)).toBe(2)
    expect(getDefaultMockExamPoints(1)).toBe(2)
  })

  it('듣기/독해 경계는 17번', () => {
    expect(getDefaultMockExamSection(17)).toBe('listening')
    expect(getDefaultMockExamSection(18)).toBe('reading')
  })

  it('유형 매핑', () => {
    expect(getDefaultMockExamQuestionType(17)).toBe('듣기')
    expect(getDefaultMockExamQuestionType(18)).toBe('목적')
    expect(getDefaultMockExamQuestionType(45)).toBe('장문-내용일치')
  })

  it('매핑에 없는 번호는 기타', () => {
    expect(getDefaultMockExamQuestionType(46)).toBe('기타')
  })

  it('기본 문항 세트는 45문항', () => {
    const questions = buildDefaultMockExamQuestions()
    expect(questions).toHaveLength(45)
    expect(questions[0].question_number).toBe(1)
    expect(questions[44].question_number).toBe(45)
  })
})

describe('calculateMockExamScore', () => {
  const questions: MockExamQuestionForGrading[] = [
    question({ id: 'q1', question_number: 1, correct_answer: '1' }),
    question({ id: 'q2', question_number: 21, correct_answer: '3', points: 3, section: 'reading', question_type: '함축의미' }),
    question({ id: 'q3', question_number: 22, correct_answer: '2', section: 'reading', question_type: '요지', is_void: true }),
    question({ id: 'q4', question_number: 23, correct_answer: '5', section: 'reading', question_type: '주제', all_correct: true }),
  ]
  const answers = [
    { question_number: 1, student_answer: '①' },
    { question_number: 21, student_answer: '3' },
    { question_number: 22, student_answer: '1' },
    { question_number: 23, student_answer: '4' },
  ]
  const result = calculateMockExamScore(questions, answers)

  it('원점수를 배점대로 합산한다', () => {
    // q1(2) + q2(3) + q4(2, 모두정답) = 7, q3는 무효문항이라 0점
    expect(result.raw_score).toBe(7)
  })

  it('무효 문항은 영역 집계에서 빠진다', () => {
    expect(result.listening_correct).toBe(1)
    expect(result.listening_total).toBe(1)
    expect(result.reading_correct).toBe(2)
    expect(result.reading_total).toBe(2) // q3 제외
  })

  it('all_correct 문항은 학생 답과 무관하게 정답 처리한다', () => {
    const q4 = result.answer_rows.find((row) => row.mock_exam_question_id === 'q4')
    expect(q4?.is_correct).toBe(true)
    expect(q4?.earned_points).toBe(2)
  })

  it('무효 문항은 오답·0점으로 기록하되 답안은 남긴다', () => {
    const q3 = result.answer_rows.find((row) => row.mock_exam_question_id === 'q3')
    expect(q3?.is_correct).toBe(false)
    expect(q3?.earned_points).toBe(0)
    expect(q3?.student_answer).toBe('1')
  })

  it('유형별 분석에서 무효 문항 유형은 total 0, 정답률 null', () => {
    expect(result.type_analysis['요지']).toMatchObject({ total: 0, correct: 0, accuracy: null, score_rate: null })
    expect(result.type_analysis['함축의미']).toMatchObject({ total: 1, correct: 1, accuracy: 100, score_rate: 100 })
  })

  it('미응답 문항은 빈 답 → null 로 저장한다', () => {
    const partial = calculateMockExamScore([question({ id: 'only', question_number: 1 })], [])
    expect(partial.raw_score).toBe(0)
    expect(partial.answer_rows[0].student_answer).toBeNull()
    expect(partial.answer_rows[0].is_correct).toBe(false)
  })

  it('원점수로 등급을 계산한다', () => {
    expect(result.grade).toBe(getEnglishAbsoluteGrade(result.raw_score))
  })
})
