import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { computeMetrics } from '@/lib/report-card'

// GET /api/report-cards/[id] — 성적표 1건 + 계산된 지표
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { id } = await params

  const { data: card, error: cardErr } = await supabase
    .from('report_card')
    .select('*')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (cardErr || !card) return err('성적표를 찾을 수 없습니다', 404)

  // 학생 정보
  const { data: student } = await supabase
    .from('student')
    .select('id, name, school, grade')
    .eq('id', card.student_id)
    .single()

  if (!student) return err('학생 정보 없음', 404)

  // 학생의 수업 목록
  const { data: classStudents } = await supabase
    .from('class_student')
    .select('class_id')
    .eq('student_id', student.id)

  const classIds = (classStudents ?? []).map((cs: { class_id: string }) => cs.class_id)
  const { data: classRows } = classIds.length > 0
    ? await supabase.from('class').select('id, name').in('id', classIds)
    : { data: [] as { id: string; name: string }[] }
  const classNameById = new Map((classRows ?? []).map((c) => [c.id, c.name]))

  // 기간 내 주차 — start_date 또는 created_at 기준
  const { data: weeks } = classIds.length > 0
    ? await supabase
        .from('week')
        .select('id, class_id, week_number, start_date, reading_total, vocab_total, homework_total, created_at')
        .in('class_id', classIds)
    : { data: [] }

  const periodStart = card.period_start
  const periodEnd = card.period_end
  const inPeriod = (weeks ?? []).filter((w: { start_date: string | null; created_at: string }) => {
    const ref = w.start_date ?? w.created_at.slice(0, 10)
    return ref >= periodStart && ref <= periodEnd
  })
  const weekIds = inPeriod.map((w: { id: string }) => w.id)

  // 학생의 채점 점수
  const { data: scores } = weekIds.length > 0
    ? await supabase
        .from('week_score')
        .select('id, week_id, reading_correct, vocab_correct, homework_done')
        .in('week_id', weekIds)
        .eq('student_id', student.id)
    : { data: [] }

  const scoreIds = (scores ?? []).map((s: { id: string }) => s.id)

  // 학생 답안 + 문항 + 태그
  const { data: rawAnswers } = scoreIds.length > 0
    ? await supabase
        .from('student_answer')
        .select(`
          id, week_score_id, is_correct,
          student_answer, student_answer_text,
          exam_question(
            id, week_id, question_number, sub_label,
            exam_type, question_style,
            correct_answer, correct_answer_text, explanation, question_text
          )
        `)
        .in('week_score_id', scoreIds)
    : { data: [] }

  const examQuestionIds = [...new Set(
    (rawAnswers ?? [])
      .map((a: { exam_question: unknown }) => {
        const eq = Array.isArray(a.exam_question) ? a.exam_question[0] : a.exam_question
        return (eq as { id?: string } | null)?.id
      })
      .filter(Boolean) as string[]
  )]

  const { data: questionTags } = examQuestionIds.length > 0
    ? await supabase
        .from('exam_question_tag')
        .select('exam_question_id, concept_tag(id, name, concept_category_id, concept_category(id, name))')
        .in('exam_question_id', examQuestionIds)
    : { data: [] }

  const tagsByQ = new Map<string, { concept_tag: { id: string; name: string; category_id: string | null; category_name: string | null } | null }[]>()
  for (const t of questionTags ?? []) {
    const row = t as { exam_question_id: string; concept_tag: unknown }
    const qid = row.exam_question_id
    const list = tagsByQ.get(qid) ?? []
    const rawTag = Array.isArray(row.concept_tag) ? row.concept_tag[0] : row.concept_tag as { id: string; name: string; concept_category_id: string | null; concept_category: unknown } | null
    const rawCat = rawTag ? (Array.isArray(rawTag.concept_category) ? rawTag.concept_category[0] : rawTag.concept_category) as { id: string; name: string } | null : null
    list.push({ concept_tag: rawTag ? {
      id: rawTag.id,
      name: rawTag.name,
      category_id: rawTag.concept_category_id ?? null,
      category_name: rawCat?.name ?? null,
    } : null })
    tagsByQ.set(qid, list)
  }

  const answers = (rawAnswers ?? []).map((a: { exam_question: unknown; [k: string]: unknown }) => {
    const eq = (Array.isArray(a.exam_question) ? a.exam_question[0] : a.exam_question) as { id: string; [k: string]: unknown } | null
    return {
      ...a,
      exam_question: eq ? { ...eq, exam_question_tag: tagsByQ.get(eq.id) ?? [] } : null,
    }
  })

  // 출석
  const { data: attendance } = classIds.length > 0
    ? await supabase
        .from('attendance')
        .select('status, date')
        .in('class_id', classIds)
        .eq('student_id', student.id)
        .gte('date', periodStart)
        .lte('date', periodEnd)
    : { data: [] }

  const metrics = computeMetrics(
    inPeriod as Parameters<typeof computeMetrics>[0],
    (scores ?? []) as Parameters<typeof computeMetrics>[1],
    answers as Parameters<typeof computeMetrics>[2],
    (attendance ?? []) as Parameters<typeof computeMetrics>[3],
    classNameById,
  )

  return ok({ card, student, metrics })
}

// PATCH /api/report-cards/[id] — 편집 (코멘트, 등급, 오답 선별, 상태)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { id } = await params
  const body = await request.json() as {
    overall_grade?: string | null
    teacher_comment?: string | null
    next_focus?: string | null
    highlighted_wrong_ids?: string[]
    status?: 'draft' | 'published'
  }

  const patch: Record<string, unknown> = {}
  if ('overall_grade' in body) patch.overall_grade = body.overall_grade
  if ('teacher_comment' in body) patch.teacher_comment = body.teacher_comment
  if ('next_focus' in body) patch.next_focus = body.next_focus
  if ('highlighted_wrong_ids' in body) patch.highlighted_wrong_ids = body.highlighted_wrong_ids
  if ('status' in body) {
    patch.status = body.status
    if (body.status === 'published') patch.published_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('report_card')
    .update(patch)
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}

// DELETE /api/report-cards/[id]
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { id } = await params
  const { error } = await supabase
    .from('report_card')
    .delete()
    .eq('id', id)
    .eq('teacher_id', teacherId)

  if (error) return err(error.message, 500)
  return ok({ success: true })
}
