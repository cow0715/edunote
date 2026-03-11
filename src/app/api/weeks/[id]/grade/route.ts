import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { gradeSubjectiveAnswers, SubjectiveStudentAnswer } from '@/lib/anthropic'

// 채점 현황 조회
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data: week } = await supabase
    .from('week')
    .select('class_id')
    .eq('id', weekId)
    .single()

  if (!week) return NextResponse.json({ error: '주차 없음' }, { status: 404 })

  const { data: classStudents } = await supabase
    .from('class_student')
    .select('student_id, student(*)')
    .eq('class_id', week.class_id)
    .order('created_at')

  const { data: weekScores } = await supabase
    .from('week_score')
    .select('*, student_answer(*)')
    .eq('week_id', weekId)

  const { data: questions } = await supabase
    .from('exam_question')
    .select('*, concept_tag(*, concept_category(*))')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')

  return NextResponse.json({ classStudents, weekScores, questions })
}

// 일괄 저장 + 서술형 AI 배치 채점
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  type GradeRow = {
    student_id: string
    student_name: string
    present: boolean
    vocab_correct: number
    homework_done: number
    memo: string
    answers: {
      exam_question_id: string
      student_answer: number | null
      student_answer_text?: string
    }[]
  }

  const rows: GradeRow[] = await request.json()

  // 이 주차의 모든 문항 정보 한 번에 조회 (style, correct_answer, 모범답안)
  const { data: allQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, correct_answer, correct_answer_text, grading_criteria, question_style')
    .eq('week_id', weekId)

  const questionMap = new Map(allQuestions?.map((q) => [q.id, q]) ?? [])

  // 서술형 배치 채점용 수집
  const subjectiveForGrading: SubjectiveStudentAnswer[] = []

  for (const row of rows) {
    if (!row.present) {
      await supabase
        .from('week_score')
        .delete()
        .eq('week_id', weekId)
        .eq('student_id', row.student_id)
      continue
    }

    const { data: score, error: scoreError } = await supabase
      .from('week_score')
      .upsert(
        { week_id: weekId, student_id: row.student_id, vocab_correct: row.vocab_correct, homework_done: row.homework_done, memo: row.memo || null },
        { onConflict: 'week_id,student_id' }
      )
      .select()
      .single()

    if (scoreError) {
      console.error('[POST /api/weeks/[id]/grade] week_score upsert', scoreError)
      return NextResponse.json({ error: scoreError.message }, { status: 500 })
    }

    if (row.answers.length > 0) {
      const answersToUpsert = row.answers.map((a) => {
        const q = questionMap.get(a.exam_question_id)
        const isSubjective = q?.question_style === 'subjective'
        return {
          week_score_id: score.id,
          exam_question_id: a.exam_question_id,
          student_answer: isSubjective ? null : a.student_answer,
          student_answer_text: isSubjective ? (a.student_answer_text ?? null) : null,
          is_correct: isSubjective
            ? false // AI 채점 후 업데이트
            : (a.student_answer !== null && a.student_answer === q?.correct_answer),
        }
      })

      const { error: answerError } = await supabase
        .from('student_answer')
        .upsert(answersToUpsert, { onConflict: 'week_score_id,exam_question_id' })

      if (answerError) {
        console.error('[POST /api/weeks/[id]/grade] student_answer upsert', answerError)
        return NextResponse.json({ error: answerError.message }, { status: 500 })
      }

      // 서술형 답안 수집
      for (const a of row.answers) {
        const q = questionMap.get(a.exam_question_id)
        if (q?.question_style === 'subjective' && a.student_answer_text?.trim()) {
          subjectiveForGrading.push({
            week_score_id: score.id,
            exam_question_id: a.exam_question_id,
            question_number: q.question_number,
            student_name: row.student_name,
            student_answer_text: a.student_answer_text.trim(),
          })
        }
      }
    }
  }

  // 서술형 AI 배치 채점
  if (subjectiveForGrading.length > 0) {
    const subjectiveQuestions = [...new Set(subjectiveForGrading.map((a) => a.question_number))]
      .map((qNum) => {
        const q = allQuestions?.find((q) => q.question_number === qNum && q.question_style === 'subjective')
        return q ? {
          question_number: q.question_number,
          correct_answer_text: q.correct_answer_text ?? '',
          grading_criteria: q.grading_criteria,
        } : null
      })
      .filter((q): q is NonNullable<typeof q> => q !== null && q.correct_answer_text !== '')

    if (subjectiveQuestions.length > 0) {
      try {
        const gradingResults = await gradeSubjectiveAnswers(subjectiveQuestions, subjectiveForGrading)

        for (const result of gradingResults) {
          await supabase
            .from('student_answer')
            .update({ is_correct: result.is_correct, ai_feedback: result.ai_feedback })
            .eq('week_score_id', result.week_score_id)
            .eq('exam_question_id', result.exam_question_id)
        }
      } catch (e) {
        console.error('[POST /api/weeks/[id]/grade] AI grading failed', e)
        // AI 실패해도 저장은 성공으로 처리, 클라이언트에 알림
        return NextResponse.json({ ok: true, ai_grading_failed: true })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
