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
  '목적',
  '심경',
  '요지',
  '주장',
  '제목',
  '도표',
  '내용일치',
  '어법',
  '어휘',
  '빈칸',
  '흐름',
  '순서',
  '삽입',
  '요약',
  '장문',
  '듣기',
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
  if ([18].includes(questionNumber)) return '목적'
  if ([19].includes(questionNumber)) return '심경'
  if ([20, 22, 23, 24].includes(questionNumber)) return '요지'
  if ([21, 31, 32, 33, 34].includes(questionNumber)) return '빈칸'
  if ([29].includes(questionNumber)) return '어법'
  if ([30].includes(questionNumber)) return '어휘'
  if ([35].includes(questionNumber)) return '흐름'
  if ([36, 37].includes(questionNumber)) return '순서'
  if ([38, 39].includes(questionNumber)) return '삽입'
  if ([40].includes(questionNumber)) return '요약'
  if (questionNumber >= 41) return '장문'
  return '내용일치'
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
