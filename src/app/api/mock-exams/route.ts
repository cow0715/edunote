import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { createMockExam } from '@/lib/services/mock-questions'
import { assertClassOwner, err, getAuth, getTeacherId, ok } from '@/lib/api'

type MockExamCreateBody = {
  title?: string
  class_id?: string | null
  exam_year?: number
  exam_month?: number
  grade?: number | null
  source?: string
  exam_date?: string | null
}

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { data, error } = await supabase
    .from('mock_exam')
    .select('*, class(id, name), mock_exam_question(id), mock_exam_result(id)')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })

  if (error) return err(error.message, 500)

  const exams = (data ?? []).map((exam) => ({
    ...exam,
    question_count: exam.mock_exam_question?.length ?? 0,
    result_count: exam.mock_exam_result?.length ?? 0,
  }))

  return ok(exams)
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const body = await request.json() as MockExamCreateBody
  const title = body.title?.trim()
  const examYear = Number(body.exam_year)
  const examMonth = Number(body.exam_month)

  if (!title) return err('시험명을 입력해 주세요')
  if (!Number.isInteger(examYear)) return err('시행연도를 입력해 주세요')
  if (!Number.isInteger(examMonth) || examMonth < 1 || examMonth > 12) return err('시행월을 확인해 주세요')

  const classId = body.class_id || null
  if (classId && !(await assertClassOwner(supabase, classId, teacherId))) {
    return err('수업 접근 권한이 없습니다', 403)
  }

  try {
    const exam=await withTeacherTransaction(user.id,context=>createMockExam(context,{
      ...body,title,exam_year:examYear,exam_month:examMonth,class_id:classId,
    }))
    return ok(exam,{status:201})
  } catch (error) { return saveErrorResponse(error) }
}
