import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const { data: questions } = await supabase
      .from('exam_question')
      .select('id')
      .eq('week_id', weekId)
      .eq('exam_type', 'reading')

    const questionIds = (questions ?? []).map((question) => question.id)
    if (questionIds.length === 0) {
      return ok({ has_student_answers: false, answer_count: 0 })
    }

    const { count, error } = await supabase
      .from('student_answer')
      .select('id', { count: 'exact', head: true })
      .in('exam_question_id', questionIds)

    if (error) return err(error.message, 500)

    return ok({
      has_student_answers: (count ?? 0) > 0,
      answer_count: count ?? 0,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '학생 답안 상태를 확인하지 못했습니다.'
    return err(message, 500)
  }
}
