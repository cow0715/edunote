import { assertClassOwner, err, getAuth, getTeacherId, ok } from '@/lib/api'
import { DEFAULT_ENGLISH_GRADE_CUTOFFS } from '@/lib/mock-exam'
import { assertMockExamOwner } from '@/lib/mock-exam-server'

type MockExamUpdateBody = {
  title?: string
  class_id?: string | null
  exam_year?: number
  exam_month?: number
  grade?: number | null
  source?: string
  exam_date?: string | null
  status?: 'draft' | 'ready' | 'published'
  grade_cutoffs?: Record<string, number>
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const [{ data: exam, error: examError }, { data: questions, error: questionError }, { data: results, error: resultError }] = await Promise.all([
    supabase.from('mock_exam').select('*, class(id, name)').eq('id', id).single(),
    supabase.from('mock_exam_question').select('*').eq('mock_exam_id', id).order('question_number'),
    supabase
      .from('mock_exam_result')
      .select('*, student(id, name, school, grade), mock_exam_report(id, share_token, status, published_at), mock_exam_student_answer(*, mock_exam_question(question_number))')
      .eq('mock_exam_id', id)
      .order('created_at', { ascending: false }),
  ])

  if (examError) return err(examError.message, 500)
  if (questionError) return err(questionError.message, 500)
  if (resultError) return err(resultError.message, 500)

  return ok({ exam, questions: questions ?? [], results: results ?? [] })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const body = await request.json() as MockExamUpdateBody
  const updates: Record<string, unknown> = {}

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.exam_year !== undefined) updates.exam_year = Number(body.exam_year)
  if (body.exam_month !== undefined) updates.exam_month = Number(body.exam_month)
  if (body.grade !== undefined) updates.grade = body.grade ? Number(body.grade) : null
  if (body.source !== undefined) updates.source = body.source.trim() || '교육청'
  if (body.exam_date !== undefined) updates.exam_date = body.exam_date || null
  if (body.status !== undefined) updates.status = body.status
  if (body.grade_cutoffs !== undefined) updates.grade_cutoffs = body.grade_cutoffs ?? DEFAULT_ENGLISH_GRADE_CUTOFFS
  if (body.class_id !== undefined) {
    if (body.class_id && !(await assertClassOwner(supabase, body.class_id, teacherId))) {
      return err('수업 접근 권한이 없습니다', 403)
    }
    updates.class_id = body.class_id || null
  }

  const { data, error } = await supabase
    .from('mock_exam')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const { error } = await supabase.from('mock_exam').delete().eq('id', id)
  if (error) return err(error.message, 500)
  return ok({ ok: true })
}
