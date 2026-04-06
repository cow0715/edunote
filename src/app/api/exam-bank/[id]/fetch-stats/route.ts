import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { getMegastudyStats } from '@/lib/megastudy'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const formType: '홀수형' | '짝수형' = body.form_type === '짝수형' ? '짝수형' : '홀수형'

  const { data: exam, error: examErr } = await supabase
    .from('exam_bank')
    .select('id, exam_year, exam_month, grade')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (examErr || !exam) return err('시험을 찾을 수 없습니다', 404)

  let stats
  try {
    stats = await getMegastudyStats(exam.grade, exam.exam_year, exam.exam_month, formType)
  } catch {
    return err('메가스터디 연결에 실패했습니다', 502)
  }

  if (!stats || stats.length === 0) {
    return err('메가스터디에 해당 시험 데이터가 없습니다. 연도/월/학년을 확인해주세요.', 404)
  }

  let updated = 0
  for (const row of stats) {
    const { error } = await supabase
      .from('exam_bank_question')
      .update({
        answer: row.answer,
        difficulty: row.difficulty,
        points: row.points,
        correct_rate: row.correct_rate,
        choice_rates: row.choice_rates,
      })
      .eq('exam_bank_id', id)
      .eq('question_number', row.question_number)

    if (!error) updated++
  }

  await supabase.from('exam_bank').update({ form_type: formType }).eq('id', id)

  return ok({ updated, total: stats.length })
}
