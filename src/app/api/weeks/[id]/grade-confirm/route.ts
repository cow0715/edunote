import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { recalcReadingCorrect } from '@/lib/grade-utils'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const body: { student_id: string; exam_question_id: string; is_correct: boolean }[] = await request.json()
  if (!body.length) return ok({ ok: true })

  // 학생 → week_score_id 조회
  const studentIds = [...new Set(body.map((b) => b.student_id))]
  const { data: scores } = await supabase
    .from('week_score')
    .select('id, student_id')
    .eq('week_id', weekId)
    .in('student_id', studentIds)

  const scoreMap = new Map(scores?.map((s) => [s.student_id, s.id]) ?? [])

  // week_score가 없는 학생 경고
  const missing = studentIds.filter((id) => !scoreMap.has(id))
  if (missing.length > 0) {
    console.warn('[PATCH /grade-confirm] week_score 없는 student_id:', missing)
  }

  await Promise.all(
    body.map(({ student_id, exam_question_id, is_correct }) => {
      const week_score_id = scoreMap.get(student_id)
      if (!week_score_id) return Promise.resolve()
      return supabase
        .from('student_answer')
        .update({ is_correct, teacher_confirmed: true, needs_review: false })
        .eq('week_score_id', week_score_id)
        .eq('exam_question_id', exam_question_id)
    })
  )

  const scoreIds = [...new Set([...scoreMap.values()])]
  await recalcReadingCorrect(supabase, scoreIds)

  return ok({ ok: true, skipped: missing.length > 0 ? missing : undefined })
}
