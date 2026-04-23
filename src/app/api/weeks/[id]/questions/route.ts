import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import type { SupabaseServerClient } from '@/lib/api'
import { recalcReadingCorrect, gradeOX, gradeMultiSelect } from '@/lib/grade-utils'

// 비객관식 문항 재채점 (OX/multi_select는 코드로 즉시, subjective/find_error는 needs_review 플래그)
// - is_void/all_correct 고정 상태는 건너뜀 (해제 시에만 호출됨)
// - teacher_confirmed 된 답안은 교사 수동 확정이므로 제외
async function regradeQuestion(
  supabase: SupabaseServerClient,
  questionId: string,
  regradeScoreIds: Set<string>
) {
  const { data: q } = await supabase
    .from('exam_question')
    .select('id, week_id, question_number, question_style, correct_answer_text, is_void, all_correct')
    .eq('id', questionId)
    .single()
  if (!q) return
  if (q.is_void || q.all_correct) return

  const style = q.question_style

  if (style === 'ox') {
    const { data: answers } = await supabase
      .from('student_answer')
      .select('id, week_score_id, ox_selection, student_answer_text, teacher_confirmed')
      .eq('exam_question_id', questionId)
    await Promise.all(
      (answers ?? [])
        .filter((a) => !a.teacher_confirmed)
        .map((a) => {
          const isCorrect = q.correct_answer_text
            ? gradeOX(q.correct_answer_text, a.ox_selection, a.student_answer_text ?? '')
            : false
          regradeScoreIds.add(a.week_score_id)
          return supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
        })
    )
    return
  }

  if (style === 'multi_select') {
    const { data: answers } = await supabase
      .from('student_answer')
      .select('id, week_score_id, student_answer_text, teacher_confirmed')
      .eq('exam_question_id', questionId)
    await Promise.all(
      (answers ?? [])
        .filter((a) => !a.teacher_confirmed)
        .map((a) => {
          const isCorrect = q.correct_answer_text && a.student_answer_text
            ? gradeMultiSelect(q.correct_answer_text, a.student_answer_text)
            : false
          regradeScoreIds.add(a.week_score_id)
          return supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
        })
    )
    return
  }

  if (style === 'subjective' || style === 'find_error') {
    // 서술형/오류교정은 AI 자동 호출 비용/대기시간 문제로 즉시 재채점하지 않음
    // → needs_review 플래그로 표시 → 교사가 채점 페이지에서 "채점 저장"을 눌러 AI 재채점
    const { data: answers } = await supabase
      .from('student_answer')
      .select('id, week_score_id, student_answer_text, teacher_confirmed')
      .eq('exam_question_id', questionId)
    await Promise.all(
      (answers ?? [])
        .filter((a) => !a.teacher_confirmed && a.student_answer_text?.trim())
        .map((a) => {
          regradeScoreIds.add(a.week_score_id)
          return supabase.from('student_answer').update({
            needs_review: true,
            ai_feedback: '모범답안/기준 변경 — 채점 페이지에서 다시 저장해주세요',
          }).eq('id', a.id)
        })
    )
  }
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

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
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

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
  // 비객관식 재채점 대기열 — 메인 루프 종료 후 일괄 처리 (모든 DB 쓰기 반영 이후)
  const pendingRegrade = new Set<string>()

  for (const { id, concept_tag_ids, question_style, correct_answer, extra_correct_answers, explanation, correct_answer_text_override, grading_criteria, is_void, all_correct } of updates) {
    // 소유 확인
    const { data: q } = await supabase
      .from('exam_question')
      .select('id, question_style, correct_answer, correct_answer_text, extra_correct_answers')
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
          const accepted = new Set([primaryAnswer, ...(q.extra_correct_answers ?? [])])
          await Promise.all(
            (answers ?? []).map((a) => {
              const isCorrect = a.student_answer !== null && accepted.has(a.student_answer)
              regradeScoreIds.add(a.week_score_id)
              return supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
            })
          )
        } else {
          // 비객관식은 메인 루프 종료 후 일괄 재채점
          pendingRegrade.add(id)
        }
      }
    }

    // 정답 수정 (객관식만, 무효/전원정답 상태가 아닐 때)
    const effectiveStyle = question_style ?? q.question_style
    if (correct_answer !== undefined && effectiveStyle === 'objective') {
      await supabase
        .from('exam_question')
        .update({ correct_answer, extra_correct_answers: extra_correct_answers ?? [] })
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
      const effectiveStyle2 = question_style ?? q.question_style
      if (correct_answer_text_override !== undefined) {
        if (effectiveStyle2 !== 'objective') {
          const prev = q.correct_answer_text ?? null
          const next = correct_answer_text_override ?? null
          textUpdate.correct_answer_text = correct_answer_text_override
          // 값이 실제로 바뀐 경우에만 재채점 대기열에 추가
          if (prev !== next) pendingRegrade.add(id)
        }
      }
      if (grading_criteria !== undefined) {
        textUpdate.grading_criteria = grading_criteria
        // 서술형 채점기준이 바뀌면 needs_review 플래그 (AI 재채점 유도)
        if (effectiveStyle2 === 'subjective') pendingRegrade.add(id)
      }
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

  // 비객관식 재채점 일괄 처리 (모범답안/채점기준 변경, 무효·전원정답 해제)
  for (const qid of pendingRegrade) {
    await regradeQuestion(supabase, qid, regradeScoreIds)
  }

  // 정답/모범답안 수정된 문항이 있으면 reading_correct 재계산
  if (regradeScoreIds.size > 0) {
    await recalcReadingCorrect(supabase, [...regradeScoreIds])
  }

  return ok({ ok: true })
}
