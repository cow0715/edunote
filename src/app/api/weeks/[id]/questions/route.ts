import { getAuth, err, ok } from '@/lib/api'
import { recalcReadingCorrect } from '@/lib/grade-utils'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { data, error } = await supabase
    .from('exam_question')
    .select('*, exam_question_tag(concept_tag(*, concept_category(*))), exam_question_choice(*)')
    .eq('week_id', weekId)
    .order('question_number')
    .order('sub_label', { nullsFirst: true })

  if (error) {
    console.error('[GET /api/weeks/[id]/questions]', error)
    return err(error.message, 500)
  }

  return ok(data)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const updates: {
    id: string
    concept_tag_ids: string[]
    question_style?: string
    correct_answer?: number | null
    extra_correct_answers?: number[]
    explanation?: string | null
    correct_answer_text_override?: string | null
    grading_criteria?: string | null
    is_void?: boolean
    all_correct?: boolean
  }[] = await request.json()

  const VALID_STYLES = ['objective', 'subjective', 'ox', 'multi_select', 'find_error']
  const regradeScoreIds = new Set<string>()

  for (const { id, concept_tag_ids, question_style, correct_answer, extra_correct_answers, explanation, correct_answer_text_override, grading_criteria, is_void, all_correct } of updates) {
    // 소유 확인
    const { data: q } = await supabase
      .from('exam_question')
      .select('id, question_style, correct_answer, correct_answer_text')
      .eq('id', id)
      .eq('week_id', weekId)
      .single()
    if (!q) continue

    // question_style 변경
    if (question_style && VALID_STYLES.includes(question_style)) {
      await supabase.from('exam_question').update({ question_style }).eq('id', id)
    }

    // 무효/전원정답 처리
    if (is_void !== undefined || all_correct !== undefined) {
      const flagUpdate: Record<string, boolean> = {}
      if (is_void !== undefined) flagUpdate.is_void = is_void
      if (all_correct !== undefined) flagUpdate.all_correct = all_correct
      await supabase.from('exam_question').update(flagUpdate).eq('id', id)

      const { data: answers } = await supabase
        .from('student_answer')
        .select('id, student_answer, week_score_id')
        .eq('exam_question_id', id)

      const effectiveIsVoid = is_void ?? false
      const effectiveAllCorrect = all_correct ?? false

      if (effectiveIsVoid) {
        // 무효: is_correct = null
        await Promise.all(
          (answers ?? []).map((a) => {
            regradeScoreIds.add(a.week_score_id)
            return supabase.from('student_answer').update({ is_correct: null }).eq('id', a.id)
          })
        )
      } else if (effectiveAllCorrect) {
        // 전원정답: is_correct = true
        await Promise.all(
          (answers ?? []).map((a) => {
            regradeScoreIds.add(a.week_score_id)
            return supabase.from('student_answer').update({ is_correct: true }).eq('id', a.id)
          })
        )
      } else {
        // 무효/전원정답 해제 → 원래 정답 기준 재채점
        const effectiveStyle = question_style ?? q.question_style
        if (effectiveStyle === 'objective') {
          const primaryAnswer = q.correct_answer
          const extraAnswers = q.correct_answer_text
            ? q.correct_answer_text.split(',').map(Number).filter((n: number) => !isNaN(n))
            : []
          const accepted = new Set([primaryAnswer, ...extraAnswers])
          await Promise.all(
            (answers ?? []).map((a) => {
              const isCorrect = a.student_answer !== null && accepted.has(a.student_answer)
              regradeScoreIds.add(a.week_score_id)
              return supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
            })
          )
        }
      }
    }

    // 정답 수정 (객관식만, 무효/전원정답 상태가 아닐 때)
    const effectiveStyle = question_style ?? q.question_style
    if (correct_answer !== undefined && effectiveStyle === 'objective') {
      const extraText = extra_correct_answers?.length ? extra_correct_answers.join(',') : null
      await supabase
        .from('exam_question')
        .update({ correct_answer, correct_answer_text: extraText })
        .eq('id', id)

      // 이 문항의 모든 학생 답안 재채점
      const { data: answers } = await supabase
        .from('student_answer')
        .select('id, student_answer, week_score_id')
        .eq('exam_question_id', id)

      const accepted = new Set([correct_answer, ...(extra_correct_answers ?? [])])
      await Promise.all(
        (answers ?? []).map((a) => {
          const isCorrect = a.student_answer !== null && accepted.has(a.student_answer)
          regradeScoreIds.add(a.week_score_id)
          return supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
        })
      )
    }

    // 해설·모범답안·채점기준 업데이트
    {
      const textUpdate: Record<string, unknown> = {}
      if (explanation !== undefined) textUpdate.explanation = explanation
      if (correct_answer_text_override !== undefined) {
        const effectiveStyle2 = question_style ?? q.question_style
        if (effectiveStyle2 !== 'objective') textUpdate.correct_answer_text = correct_answer_text_override
      }
      if (grading_criteria !== undefined) textUpdate.grading_criteria = grading_criteria
      if (Object.keys(textUpdate).length > 0) {
        await supabase.from('exam_question').update(textUpdate).eq('id', id)
      }
    }

    // 태그 교체
    await supabase.from('exam_question_tag').delete().eq('exam_question_id', id)
    if (concept_tag_ids.length > 0) {
      const { error } = await supabase.from('exam_question_tag').insert(
        concept_tag_ids.map((tag_id) => ({ exam_question_id: id, concept_tag_id: tag_id }))
      )
      if (error) return err(error.message, 500)
    }
  }

  // 정답 수정된 문항이 있으면 reading_correct 재계산
  if (regradeScoreIds.size > 0) {
    await recalcReadingCorrect(supabase, [...regradeScoreIds])
  }

  return ok({ ok: true })
}
