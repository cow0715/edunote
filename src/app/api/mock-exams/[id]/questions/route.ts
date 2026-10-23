import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { replaceMockQuestions } from '@/lib/services/mock-questions'
import { err, getAuth, getTeacherId, ok } from '@/lib/api'
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

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const questions = await request.json() as QuestionUpdate[]
  if (!Array.isArray(questions)) return err('문항 배열이 필요합니다')

  const rows: Record<string, unknown>[] = []
  for (const question of questions) {
    const normalized = normalizeQuestionUpdate(question, id)
    if ('error' in normalized) return err(normalized.error ?? '문항 정보를 확인해 주세요')
    rows.push(normalized.row)
  }

  const numbers = rows.map((row) => row.question_number)
  if (new Set(numbers).size !== numbers.length) return err('중복된 문항 번호가 있습니다')

  try {
    const data=await withTeacherTransaction(user.id,context=>replaceMockQuestions(context,id,rows))
    return ok(data)
  } catch (error) { return saveErrorResponse(error) }
}
