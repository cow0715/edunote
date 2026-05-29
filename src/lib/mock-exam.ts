export type MockExamSection = 'listening' | 'reading'
export type MockExamDifficulty = 'low' | 'medium' | 'high'

export type MockExamQuestionForGrading = {
  id: string
  question_number: number
  correct_answer: string
  points: number
  section: MockExamSection
  question_type: string
  is_void: boolean
  all_correct: boolean
  extra_correct_answers: unknown[] | null
}

export type MockExamAnswerInput = {
  question_number: number
  student_answer?: unknown
}

export const MOCK_EXAM_TYPE_OPTIONS = [
  '듣기',
  '목적',
  '심경',
  '주장',
  '함축의미',
  '요지',
  '주제',
  '제목',
  '도표',
  '내용일치/불일치',
  '실용문',
  '어법',
  '어휘',
  '빈칸',
  '무관문장',
  '순서',
  '문장삽입',
  '요약',
  '장문-제목',
  '장문-어휘',
  '장문-순서',
  '장문-지칭',
  '장문-내용일치',
] as const

export const DEFAULT_ENGLISH_GRADE_CUTOFFS = {
  1: 90,
  2: 80,
  3: 70,
  4: 60,
  5: 50,
  6: 40,
  7: 30,
  8: 20,
}

const DEFAULT_THREE_POINT_QUESTIONS = new Set([21, 29, 30, 31, 32, 33, 34, 37, 38, 39])

export function getDefaultMockExamPoints(questionNumber: number) {
  return DEFAULT_THREE_POINT_QUESTIONS.has(questionNumber) ? 3 : 2
}

export function getDefaultMockExamSection(questionNumber: number): MockExamSection {
  return questionNumber <= 17 ? 'listening' : 'reading'
}

export function getDefaultMockExamQuestionType(questionNumber: number) {
  if (questionNumber <= 17) return '듣기'
  const typeByNumber: Record<number, string> = {
    18: '목적',
    19: '심경',
    20: '주장',
    21: '함축의미',
    22: '요지',
    23: '주제',
    24: '제목',
    25: '도표',
    26: '내용일치/불일치',
    27: '실용문',
    28: '실용문',
    29: '어법',
    30: '어휘',
    31: '빈칸',
    32: '빈칸',
    33: '빈칸',
    34: '빈칸',
    35: '무관문장',
    36: '순서',
    37: '순서',
    38: '문장삽입',
    39: '문장삽입',
    40: '요약',
    41: '장문-제목',
    42: '장문-어휘',
    43: '장문-순서',
    44: '장문-지칭',
    45: '장문-내용일치',
  }
  return typeByNumber[questionNumber] ?? '기타'
}

export function getEnglishAbsoluteGrade(
  score: number | null | undefined,
  cutoffs: Record<string, number> | null | undefined = DEFAULT_ENGLISH_GRADE_CUTOFFS,
) {
  if (score == null) return null
  const entries = Object.entries(cutoffs ?? DEFAULT_ENGLISH_GRADE_CUTOFFS)
    .map(([grade, cutoff]) => [Number(grade), Number(cutoff)] as const)
    .filter(([grade, cutoff]) => Number.isFinite(grade) && Number.isFinite(cutoff))
    .sort((a, b) => a[0] - b[0])

  for (const [grade, cutoff] of entries) {
    if (score >= cutoff) return grade
  }
  return 9
}

export function normalizeAnswer(value: unknown) {
  if (value == null) return ''
  const circled: Record<string, string> = {
    '①': '1',
    '②': '2',
    '③': '3',
    '④': '4',
    '⑤': '5',
  }
  return String(value)
    .trim()
    .replace(/[①②③④⑤]/g, (match) => circled[match] ?? match)
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, '')
    .toLowerCase()
}

export function isMockAnswerCorrect(studentAnswer: unknown, correctAnswer: unknown, extraCorrectAnswers?: unknown[]) {
  const normalized = normalizeAnswer(studentAnswer)
  if (!normalized) return false
  const correctAnswers = [correctAnswer, ...(extraCorrectAnswers ?? [])]
    .map(normalizeAnswer)
    .filter(Boolean)
  return correctAnswers.includes(normalized)
}

export function calculateMockExamScore(
  questions: MockExamQuestionForGrading[],
  answers: MockExamAnswerInput[],
  gradeCutoffs?: Record<string, number> | null,
) {
  const answerMap = new Map(
    answers.map((answer) => [Number(answer.question_number), normalizeAnswer(answer.student_answer)])
  )

  let rawScore = 0
  let listeningCorrect = 0
  let listeningTotal = 0
  let readingCorrect = 0
  let readingTotal = 0
  const typeAnalysis = new Map<string, { correct: number; total: number; earned: number; points: number }>()

  const answerRows = questions.map((question) => {
    const studentAnswer = answerMap.get(question.question_number) ?? ''
    const totalKey = question.question_type || '기타'
    const bucket = typeAnalysis.get(totalKey) ?? { correct: 0, total: 0, earned: 0, points: 0 }

    if (question.is_void) {
      typeAnalysis.set(totalKey, bucket)
      return {
        mock_exam_question_id: question.id,
        student_answer: studentAnswer || null,
        is_correct: false,
        earned_points: 0,
      }
    }

    const isCorrect = question.all_correct || isMockAnswerCorrect(
      studentAnswer,
      question.correct_answer,
      question.extra_correct_answers ?? [],
    )
    const earnedPoints = isCorrect ? question.points : 0

    rawScore += earnedPoints
    bucket.total += 1
    bucket.points += question.points
    bucket.earned += earnedPoints
    if (isCorrect) bucket.correct += 1
    typeAnalysis.set(totalKey, bucket)

    if (question.section === 'listening') {
      listeningTotal += 1
      if (isCorrect) listeningCorrect += 1
    } else {
      readingTotal += 1
      if (isCorrect) readingCorrect += 1
    }

    return {
      mock_exam_question_id: question.id,
      student_answer: studentAnswer || null,
      is_correct: isCorrect,
      earned_points: earnedPoints,
    }
  })

  const typeAnalysisJson = Object.fromEntries(
    [...typeAnalysis.entries()].map(([key, value]) => [
      key,
      {
        ...value,
        accuracy: value.total > 0 ? Math.round((value.correct / value.total) * 100) : null,
        score_rate: value.points > 0 ? Math.round((value.earned / value.points) * 100) : null,
      },
    ])
  )

  return {
    raw_score: rawScore,
    grade: getEnglishAbsoluteGrade(rawScore, gradeCutoffs),
    listening_correct: listeningCorrect,
    listening_total: listeningTotal,
    reading_correct: readingCorrect,
    reading_total: readingTotal,
    type_analysis: typeAnalysisJson,
    answer_rows: answerRows,
  }
}

export function buildDefaultMockExamQuestions() {
  return Array.from({ length: 45 }, (_, index) => {
    const questionNumber = index + 1
    return {
      question_number: questionNumber,
      correct_answer: '',
      points: getDefaultMockExamPoints(questionNumber),
      section: getDefaultMockExamSection(questionNumber),
      question_type: getDefaultMockExamQuestionType(questionNumber),
      difficulty: 'medium' as MockExamDifficulty,
      is_void: false,
      all_correct: false,
      extra_correct_answers: [],
    }
  })
}
