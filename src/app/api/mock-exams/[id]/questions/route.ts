import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { calculateMockExamScore, type MockExamQuestionForGrading } from '@/lib/mock-exam'
import { assertMockExamOwner } from '@/lib/mock-exam-server'

type QuestionUpdate = {
  id?: string
  question_number: number
  correct_answer?: string
  points?: number
  section?: 'listening' | 'reading'
  question_type?: string
  difficulty?: 'low' | 'medium' | 'high'
  is_void?: boolean
  all_correct?: boolean
  extra_correct_answers?: string[]
}

type ResultWithAnswers = {
  id: string
  student_id: string
  teacher_comment: string | null
  status: 'draft' | 'published'
  mock_exam_student_answer?: {
    student_answer: string | null
    mock_exam_question?: { question_number: number } | { question_number: number }[] | null
  }[]
}

const VALID_SECTIONS = new Set(['listening', 'reading'])
const VALID_DIFFICULTIES = new Set(['low', 'medium', 'high'])

function normalizeQuestionUpdate(question: QuestionUpdate, examId: string) {
  const questionNumber = Number(question.question_number)
  if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > 45) {
    return { error: '문항 번호는 1~45번이어야 합니다' }
  }

  const points = Number(question.points ?? 2)
  if (!Number.isInteger(points) || points < 1 || points > 100) {
    return { error: `${questionNumber}번 배점은 1~100 사이의 정수여야 합니다` }
  }

  const section = question.section ?? (questionNumber <= 17 ? 'listening' : 'reading')
  if (!VALID_SECTIONS.has(section)) {
    return { error: `${questionNumber}번 영역이 올바르지 않습니다` }
  }

  const difficulty = question.difficulty ?? 'medium'
  if (!VALID_DIFFICULTIES.has(difficulty)) {
    return { error: `${questionNumber}번 난도가 올바르지 않습니다` }
  }

  return {
    row: {
      mock_exam_id: examId,
      question_number: questionNumber,
      correct_answer: question.correct_answer?.trim() ?? '',
      points,
      section,
      question_type: question.question_type?.trim() || '내용일치',
      difficulty,
      is_void: !!question.is_void,
      all_correct: !!question.all_correct,
      extra_correct_answers: question.extra_correct_answers ?? [],
    },
  }
}

async function recalcExistingResults(supabase: Awaited<ReturnType<typeof getAuth>>['supabase'], examId: string) {
  const [{ data: exam }, { data: questions }, { data: results }] = await Promise.all([
    supabase.from('mock_exam').select('grade_cutoffs').eq('id', examId).single(),
    supabase.from('mock_exam_question').select('*').eq('mock_exam_id', examId).order('question_number'),
    supabase
      .from('mock_exam_result')
      .select('id, student_id, teacher_comment, status, mock_exam_student_answer(student_answer, mock_exam_question(question_number))')
      .eq('mock_exam_id', examId),
  ])

  const questionRows = (questions ?? []) as MockExamQuestionForGrading[]
  for (const result of (results ?? []) as unknown as ResultWithAnswers[]) {
    const answers = (result.mock_exam_student_answer ?? []).map((answer) => ({
      question_number: Array.isArray(answer.mock_exam_question)
        ? answer.mock_exam_question[0]?.question_number ?? 0
        : answer.mock_exam_question?.question_number ?? 0,
      student_answer: answer.student_answer,
    }))
    const score = calculateMockExamScore(
      questionRows,
      answers,
      exam?.grade_cutoffs as Record<string, number> | null,
    )

    const { error: resultError } = await supabase
      .from('mock_exam_result')
      .update({
        raw_score: score.raw_score,
        grade: score.grade,
        listening_correct: score.listening_correct,
        listening_total: score.listening_total,
        reading_correct: score.reading_correct,
        reading_total: score.reading_total,
        type_analysis: score.type_analysis,
      })
      .eq('id', result.id)

    if (resultError) throw new Error(resultError.message)

    const { error: answerError } = await supabase
      .from('mock_exam_student_answer')
      .upsert(
        score.answer_rows.map((answer) => ({
          mock_exam_result_id: result.id,
          ...answer,
        })),
        { onConflict: 'mock_exam_result_id,mock_exam_question_id' },
      )

    if (answerError) throw new Error(answerError.message)
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const questions = await request.json() as QuestionUpdate[]
  if (!Array.isArray(questions)) return err('문항 배열이 필요합니다')

  const rows = []
  for (const question of questions) {
    const normalized = normalizeQuestionUpdate(question, id)
    if ('error' in normalized) return err(normalized.error ?? '문항 정보를 확인해 주세요')
    rows.push(normalized.row)
  }

  const numbers = rows.map((row) => row.question_number)
  if (new Set(numbers).size !== numbers.length) return err('중복된 문항 번호가 있습니다')

  const { data, error } = await supabase
    .from('mock_exam_question')
    .upsert(rows, { onConflict: 'mock_exam_id,question_number' })
    .select()

  if (error) return err(error.message, 500)

  try {
    await recalcExistingResults(supabase, id)
  } catch (error) {
    return err(error instanceof Error ? error.message : '기존 성적 재계산 실패', 500)
  }

  return ok(data)
}
