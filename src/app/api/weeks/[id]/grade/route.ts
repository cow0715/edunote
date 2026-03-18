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
    .select('class_id, start_date')
    .eq('id', weekId)
    .single()

  if (!week) return NextResponse.json({ error: '주차 없음' }, { status: 404 })

  const [{ data: classStudents }, { data: weekScores }, { data: questions }] = await Promise.all([
    supabase.from('class_student').select('student_id, student(*)').eq('class_id', week.class_id).order('created_at'),
    supabase.from('week_score').select('*, student_answer(*)').eq('week_id', weekId),
    supabase.from('exam_question').select('*, exam_question_tag(concept_tag(*, concept_category(*)))').eq('week_id', weekId).eq('exam_type', 'reading').order('question_number').order('sub_label', { nullsFirst: true }),
  ])

  let attendance: { student_id: string; status: string }[] = []
  if (week.start_date) {
    const { data: att } = await supabase
      .from('attendance')
      .select('student_id, status')
      .eq('class_id', week.class_id)
      .eq('date', week.start_date)
    attendance = att ?? []
  }

  return NextResponse.json({ classStudents, weekScores, questions, attendance })
}

// 일괄 저장 + 서술형 AI 배치 채점
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await handlePost(request, params)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[POST /api/weeks/[id]/grade] unhandled error', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handlePost(request: Request, params: Promise<{ id: string }>) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  type GradeRow = {
    student_id: string
    student_name: string
    present: boolean
    vocab_correct: number | null
    reading_correct: number | null
    homework_done: number | null
    memo: string
    answers: {
      exam_question_id: string
      student_answer: number | null
      student_answer_text?: string
    }[]
  }

  let rows: GradeRow[]
  try {
    rows = await request.json()
  } catch {
    return NextResponse.json({ error: '요청 데이터 파싱 실패' }, { status: 400 })
  }

  // 이 주차의 모든 문항 정보 한 번에 조회 (style, correct_answer, 모범답안)
  const { data: allQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label, correct_answer, correct_answer_text, grading_criteria, question_style')
    .eq('week_id', weekId)

  const questionMap = new Map(allQuestions?.map((q) => [q.id, q]) ?? [])

  function gradeOX(correctAnswerText: string, studentAnswerText: string): boolean {
    const correct = correctAnswerText.trim()
    const student = studentAnswerText.trim().toLowerCase()
    if (/^O$/i.test(correct)) return /^o$/i.test(student)
    let correction = correct.match(/\((.+)\)/)?.[1]?.trim().toLowerCase() ?? ''
    if (correction.includes('→')) correction = correction.split('→').pop()?.trim() ?? correction
    if (/^o$/i.test(student)) return false
    // '/' 구분자로 복수 정답 허용 (예: "in which / where")
    const alternatives = correction.split('/').map((s) => s.trim()).filter(Boolean)
    return alternatives.some((alt) => student === alt)
  }

  function gradeMultiSelect(correctAnswerText: string, studentAnswerText: string): boolean {
    const normalize = (t: string) => t.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).sort().join(',')
    return normalize(correctAnswerText) === normalize(studentAnswerText)
  }

  // 서술형 배치 채점용 수집
  const subjectiveForGrading: SubjectiveStudentAnswer[] = []
  const processedScoreIds: string[] = []

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
        { week_id: weekId, student_id: row.student_id, vocab_correct: row.vocab_correct, reading_correct: row.reading_correct, homework_done: row.homework_done, memo: row.memo || null },
        { onConflict: 'week_id,student_id' }
      )
      .select()
      .single()

    if (scoreError) {
      console.error('[POST /api/weeks/[id]/grade] week_score upsert', scoreError)
      return NextResponse.json({ error: scoreError.message }, { status: 500 })
    }

    processedScoreIds.push(score.id)

    if (row.answers.length > 0) {
      const answersToUpsert = row.answers.map((a) => {
        const q = questionMap.get(a.exam_question_id)
        const style = q?.question_style ?? 'objective'
        const isTextAnswer = style === 'subjective' || style === 'ox' || style === 'multi_select'
        const is_correct = style === 'objective'
          ? (a.student_answer !== null && a.student_answer === q?.correct_answer)
          : style === 'ox'
            ? (q?.correct_answer_text ? gradeOX(q.correct_answer_text, a.student_answer_text ?? '') : false)
            : style === 'multi_select'
              ? (q?.correct_answer_text ? gradeMultiSelect(q.correct_answer_text, a.student_answer_text ?? '') : false)
              : false // subjective: AI 채점 후 업데이트
        return {
          week_score_id: score.id,
          exam_question_id: a.exam_question_id,
          student_answer: isTextAnswer ? null : a.student_answer,
          student_answer_text: isTextAnswer ? (a.student_answer_text ?? null) : null,
          is_correct,
        }
      })

      const { error: answerError } = await supabase
        .from('student_answer')
        .upsert(answersToUpsert, { onConflict: 'week_score_id,exam_question_id' })

      if (answerError) {
        console.error('[POST /api/weeks/[id]/grade] student_answer upsert', answerError)
        return NextResponse.json({ error: answerError.message }, { status: 500 })
      }

      // subjective만 AI 채점용으로 수집
      for (const a of row.answers) {
        const q = questionMap.get(a.exam_question_id)
        if (q?.question_style === 'subjective' && (a.student_answer_text ?? '').trim()) {
          subjectiveForGrading.push({
            week_score_id: score.id,
            exam_question_id: a.exam_question_id,
            question_number: q.question_number,
            sub_label: q.sub_label ?? null,
            student_name: row.student_name,
            student_answer_text: a.student_answer_text?.trim() ?? '',
          })
        }
      }
    }
  }

  // 서술형 AI 배치 채점
  if (subjectiveForGrading.length > 0) {
    const uniqueKeys = [...new Set(subjectiveForGrading.map((a) => `${a.question_number}__${a.sub_label ?? ''}`))]
    const subjectiveQuestions = uniqueKeys
      .map((key) => {
        const [qNumStr, subLabel] = key.split('__')
        const qNum = Number(qNumStr)
        const sub = subLabel || null
        const q = allQuestions?.find((q) => q.question_number === qNum && q.sub_label === sub && q.question_style === 'subjective')
        return q ? {
          question_number: q.question_number,
          sub_label: q.sub_label ?? null,
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
        const errMsg = e instanceof Error ? e.message : String(e)
        console.error('[POST /api/weeks/[id]/grade] AI grading failed', e)
        // AI 실패해도 저장은 성공으로 처리 (reading_correct는 객관식만 반영됨)
        await Promise.all(
          processedScoreIds.map(async (scoreId) => {
            const { data: answers } = await supabase
              .from('student_answer')
              .select('is_correct')
              .eq('week_score_id', scoreId)
            const readingCorrect = answers && answers.length > 0
              ? answers.filter((a) => a.is_correct).length
              : null
            await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', scoreId)
          })
        )
        return NextResponse.json({ ok: true, ai_grading_failed: true, ai_error: errMsg })
      }
    }
  }

  // student_answer.is_correct 기준으로 reading_correct 자동 계산 (답안 없으면 null)
  await Promise.all(
    processedScoreIds.map(async (scoreId) => {
      const { data: answers } = await supabase
        .from('student_answer')
        .select('is_correct')
        .eq('week_score_id', scoreId)
      const readingCorrect = answers && answers.length > 0
        ? answers.filter((a) => a.is_correct).length
        : null
      await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', scoreId)
    })
  )

  return NextResponse.json({ ok: true })
}

