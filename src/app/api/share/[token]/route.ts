import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = await createClient()
  const { token } = await params

  // 토큰으로 학생 조회 (인증 불필요)
  const { data: student } = await supabase
    .from('student')
    .select('*')
    .eq('share_token', token)
    .single()

  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })

  // 해당 학생이 수강 중인 수업 목록
  const { data: classStudents } = await supabase
    .from('class_student')
    .select('class(*)')
    .eq('student_id', student.id)

  const classes = (classStudents ?? []).map((cs: { class: unknown }) => cs.class) as { id: string; name: string; start_date: string; end_date: string }[]
  const classIds = classes.map((c) => c.id)

  if (classIds.length === 0) {
    return NextResponse.json({ student, classes: [], weeks: [], weekScores: [], studentAnswers: [], attendance: [] })
  }

  // 각 수업의 주차 목록
  const { data: weeks } = await supabase
    .from('week')
    .select('*')
    .in('class_id', classIds)
    .order('week_number')

  const weekIds = (weeks ?? []).map((w) => w.id)

  // 학생의 채점 결과
  const { data: weekScores } = await supabase
    .from('week_score')
    .select('*')
    .in('week_id', weekIds)
    .eq('student_id', student.id)

  const scoreIds = (weekScores ?? []).map((s) => s.id)

  // 문항별 학생 답안 (문제 유형 포함)
  const { data: studentAnswers } = scoreIds.length > 0
    ? await supabase
        .from('student_answer')
        .select('id, week_score_id, is_correct, student_answer, exam_question(id, week_id, exam_type, concept_tag(id, name))')
        .in('week_score_id', scoreIds)
    : { data: [] }

  // 시험 문항 (전체 exam_type, 개수 파악용)
  const { data: questions } = weekIds.length > 0
    ? await supabase
        .from('exam_question')
        .select('id, week_id')
        .in('week_id', weekIds)
        .order('question_number')
    : { data: [] }

  // 출결 데이터
  const { data: attendanceRecords } = classIds.length > 0
    ? await supabase
        .from('attendance')
        .select('id, class_id, date, status')
        .in('class_id', classIds)
        .eq('student_id', student.id)
        .order('date', { ascending: false })
    : { data: [] }

  return NextResponse.json({
    student,
    classes,
    weeks: weeks ?? [],
    weekScores: weekScores ?? [],
    studentAnswers: studentAnswers ?? [],
    questions: questions ?? [],
    attendance: attendanceRecords ?? [],
  })
}
