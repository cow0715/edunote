import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// 채점 현황 조회
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  // 해당 주차의 수업에 등록된 학생 목록
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

  // 기존 채점 데이터
  const { data: weekScores } = await supabase
    .from('week_score')
    .select('*, student_answer(*)')
    .eq('week_id', weekId)

  // 시험 문항
  const { data: questions } = await supabase
    .from('exam_question')
    .select('*, question_type(*)')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')

  return NextResponse.json({ classStudents, weekScores, questions })
}

// 일괄 저장
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  type GradeRow = {
    student_id: string
    present: boolean
    vocab_correct: number
    homework_done: number
    memo: string
    answers: { exam_question_id: string; student_answer: number | null }[]
  }

  const rows: GradeRow[] = await request.json()

  for (const row of rows) {
    if (!row.present) {
      // 결석: week_score 삭제 (cascade로 student_answer도 삭제)
      await supabase
        .from('week_score')
        .delete()
        .eq('week_id', weekId)
        .eq('student_id', row.student_id)
      continue
    }

    // 출석: week_score upsert
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

    // student_answer upsert
    if (row.answers.length > 0) {
      const answersToUpsert = row.answers.map((a) => ({
        week_score_id: score.id,
        exam_question_id: a.exam_question_id,
        student_answer: a.student_answer,
        is_correct: false, // 아래서 계산
      }))

      // 정답 대조
      const { data: questions } = await supabase
        .from('exam_question')
        .select('id, correct_answer')
        .in('id', row.answers.map((a) => a.exam_question_id))

      const correctMap = new Map(questions?.map((q) => [q.id, q.correct_answer]) ?? [])

      const withCorrect = answersToUpsert.map((a) => ({
        ...a,
        is_correct: a.student_answer !== null && a.student_answer === correctMap.get(a.exam_question_id),
      }))

      const { error: answerError } = await supabase
        .from('student_answer')
        .upsert(withCorrect, { onConflict: 'week_score_id,exam_question_id' })

      if (answerError) {
        console.error('[POST /api/weeks/[id]/grade] student_answer upsert', answerError)
        return NextResponse.json({ error: answerError.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
