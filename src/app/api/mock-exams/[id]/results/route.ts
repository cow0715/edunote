import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { calculateMockExamScore, type MockExamQuestionForGrading } from '@/lib/mock-exam'
import { assertMockExamOwner, assertMockExamStudentAllowed } from '@/lib/mock-exam-server'

type SaveResultBody = {
  student_id?: string
  answers?: { question_number: number; student_answer?: string | number | null }[]
  teacher_comment?: string | null
  status?: 'draft' | 'published'
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const body = await request.json() as SaveResultBody
  if (!body.student_id) return err('학생을 선택해 주세요')

  const [{ data: exam }, { data: questions, error: questionError }] = await Promise.all([
    supabase.from('mock_exam').select('grade_cutoffs, class_id, exam_date').eq('id', id).single(),
    supabase.from('mock_exam_question').select('*').eq('mock_exam_id', id).order('question_number'),
  ])

  if (!exam) return err('모의고사를 찾을 수 없습니다', 404)
  if (questionError) return err(questionError.message, 500)
  if (!(await assertMockExamStudentAllowed(supabase, body.student_id, teacherId, exam.class_id, exam.exam_date))) {
    return err('학생 접근 권한이 없습니다', 403)
  }

  const questionRows = (questions ?? []) as MockExamQuestionForGrading[]
  if (questionRows.length === 0) return err('등록된 문항이 없습니다')

  const score = calculateMockExamScore(
    questionRows,
    body.answers ?? [],
    exam.grade_cutoffs as Record<string, number> | null,
  )

  const { data: result, error: resultError } = await supabase
    .from('mock_exam_result')
    .upsert({
      mock_exam_id: id,
      student_id: body.student_id,
      raw_score: score.raw_score,
      grade: score.grade,
      listening_correct: score.listening_correct,
      listening_total: score.listening_total,
      reading_correct: score.reading_correct,
      reading_total: score.reading_total,
      type_analysis: score.type_analysis,
      teacher_comment: body.teacher_comment ?? null,
      status: body.status ?? 'draft',
    }, { onConflict: 'mock_exam_id,student_id' })
    .select()
    .single()

  if (resultError) return err(resultError.message, 500)

  const upsertAnswers = score.answer_rows.map((answer) => ({
    mock_exam_result_id: result.id,
    ...answer,
  }))
  const { error: answerError } = await supabase
    .from('mock_exam_student_answer')
    .upsert(upsertAnswers, { onConflict: 'mock_exam_result_id,mock_exam_question_id' })

  if (answerError) return err(answerError.message, 500)

  return ok(result)
}
