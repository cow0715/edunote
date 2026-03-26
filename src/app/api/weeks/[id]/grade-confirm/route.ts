import { getAuth, err, ok } from '@/lib/api'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

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

  // reading_correct 재계산
  const scoreIds = [...new Set([...scoreMap.values()])]
  await Promise.all(
    scoreIds.map(async (scoreId) => {
      const { data: answers } = await supabase
        .from('student_answer')
        .select('is_correct')
        .eq('week_score_id', scoreId)
      const readingCorrect =
        answers && answers.length > 0 ? answers.filter((a) => a.is_correct).length : null
      await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', scoreId)
    })
  )

  return ok({ ok: true })
}
