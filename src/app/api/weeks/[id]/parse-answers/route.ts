import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { parseAnswerSheet, gradeSubjectiveAnswers, SubjectiveStudentAnswer } from '@/lib/anthropic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { fileData, mimeType } = await request.json()
  if (!fileData || !mimeType) return NextResponse.json({ error: '파일 없음' }, { status: 400 })

  // ── 1. 해설지 파싱 ────────────────────────────────────────────────────
  let parsedAnswers
  try {
    parsedAnswers = await parseAnswerSheet(fileData, mimeType)
  } catch (e) {
    console.error('[parse-answers] 파싱 실패', e)
    return NextResponse.json({ error: '해설지 파싱 실패. 파일을 확인해주세요.' }, { status: 422 })
  }

  if (!parsedAnswers.length) {
    return NextResponse.json({ error: '문항을 찾을 수 없습니다' }, { status: 422 })
  }

  // ── 2. 기존 reading 문항 전체 교체 ────────────────────────────────────
  // 기존 문항 삭제 (student_answer cascade 포함)
  await supabase
    .from('exam_question')
    .delete()
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  // 새 문항 삽입
  const { data: inserted, error: insertErr } = await supabase
    .from('exam_question')
    .insert(
      parsedAnswers.map((a) => ({
        week_id: weekId,
        exam_type: 'reading',
        question_number: a.question_number,
        question_style: a.question_style,
        correct_answer: a.correct_answer,
        correct_answer_text: a.correct_answer_text,
        grading_criteria: a.grading_criteria,
      }))
    )
    .select('id, question_number, question_style, correct_answer, correct_answer_text, grading_criteria')

  if (insertErr) {
    console.error('[parse-answers] insert 실패', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const questions = inserted ?? []

  // ── 3. 기존 학생 답안 재채점 ──────────────────────────────────────────
  const { data: weekScores } = await supabase
    .from('week_score')
    .select('id, student_id, student_answer(id, exam_question_id, student_answer, student_answer_text, is_correct)')
    .eq('week_id', weekId)

  if (!weekScores?.length) {
    return NextResponse.json({ ok: true, questions_parsed: questions.length, students_regraded: 0 })
  }

  const studentIds = weekScores.map((s) => s.student_id)
  const { data: students } = await supabase
    .from('student')
    .select('id, name')
    .in('id', studentIds)
  const studentNameMap = new Map((students ?? []).map((s) => [s.id, s.name]))

  const questionByNumber = new Map(questions.map((q) => [q.question_number, q]))
  const questionById = new Map(questions.map((q) => [q.id, q]))

  const subjectiveForGrading: SubjectiveStudentAnswer[] = []

  for (const score of weekScores) {
    type AnswerRow = { id: string; exam_question_id: string; student_answer: number | null; student_answer_text: string | null; is_correct: boolean }
    const answers: AnswerRow[] = (score.student_answer as unknown as AnswerRow[]) ?? []

    for (const a of answers) {
      const q = questionById.get(a.exam_question_id)
      if (!q) continue

      if (q.question_style === 'objective') {
        const isCorrect = a.student_answer !== null && a.student_answer === q.correct_answer
        if (isCorrect !== a.is_correct) {
          await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', a.id)
        }
      } else if (q.question_style === 'subjective' && a.student_answer_text?.trim()) {
        subjectiveForGrading.push({
          week_score_id: score.id,
          exam_question_id: a.exam_question_id,
          question_number: q.question_number,
          student_name: studentNameMap.get(score.student_id) ?? score.student_id,
          student_answer_text: a.student_answer_text!.trim(),
        })
      }
    }
  }

  // 서술형 AI 채점
  if (subjectiveForGrading.length > 0) {
    const subjectiveQuestions = [...new Set(subjectiveForGrading.map((a) => a.question_number))]
      .map((qNum) => {
        const q = questionByNumber.get(qNum)
        return q?.question_style === 'subjective' && q.correct_answer_text
          ? { question_number: q.question_number, correct_answer_text: q.correct_answer_text, grading_criteria: q.grading_criteria }
          : null
      })
      .filter((q): q is NonNullable<typeof q> => q !== null)

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
        console.error('[parse-answers] 서술형 AI 채점 실패', e)
        return NextResponse.json({ ok: true, questions_parsed: questions.length, students_regraded: weekScores.length, subjective_grading_failed: true })
      }
    }
  }

  return NextResponse.json({ ok: true, questions_parsed: questions.length, students_regraded: weekScores.length })
}
