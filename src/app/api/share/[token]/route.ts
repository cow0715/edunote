import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  console.log('[share] key present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY, 'url:', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
  const supabase = createServiceClient()
  const { token } = await params

  // 토큰으로 학생 조회 (인증 불필요)
  const { data: student } = await supabase
    .from('student')
    .select('*')
    .eq('share_token', token)
    .single()

  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })

  // 해당 학생이 수강 중인 수업 목록 (class는 SQL 예약어라 embedding 대신 2단계 조회)
  const { data: classStudents } = await supabase
    .from('class_student')
    .select('class_id')
    .eq('student_id', student.id)

  const rawClassIds = (classStudents ?? []).map((cs: { class_id: string }) => cs.class_id).filter(Boolean)
  const { data: classRows } = rawClassIds.length > 0
    ? await supabase.from('class').select('*').in('id', rawClassIds)
    : { data: [] }

  const classes = (classRows ?? []) as { id: string; name: string; start_date: string; end_date: string }[]
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

  // 반 전체 주차별 점수 (반 평균 계산용)
  const { data: allWeekScores } = weekIds.length > 0
    ? await supabase.from('week_score').select('week_id, reading_correct, vocab_correct').in('week_id', weekIds)
    : { data: [] }

  // 학생의 채점 결과
  const { data: weekScores } = await supabase
    .from('week_score')
    .select('*')
    .in('week_id', weekIds)
    .eq('student_id', student.id)

  const scoreIds = (weekScores ?? []).map((s) => s.id)

  // 문항별 학생 답안
  const { data: rawAnswers, error: answersError } = scoreIds.length > 0
    ? await supabase
        .from('student_answer')
        .select(`
          id, week_score_id, is_correct,
          student_answer, student_answer_text, ai_feedback,
          exam_question(
            id, week_id, question_number, sub_label,
            exam_type, question_style,
            correct_answer, correct_answer_text, explanation, question_text
          )
        `)
        .in('week_score_id', scoreIds)
    : { data: [] }

  // 문항 태그를 별도 쿼리로 가져와서 병합 (4단계 중첩 embedding 우회)
  const examQuestionIds = [...new Set(
    (rawAnswers ?? [])
      .map((a: any) => Array.isArray(a.exam_question) ? a.exam_question[0]?.id : a.exam_question?.id)
      .filter(Boolean) as string[]
  )]
  const { data: questionTags } = examQuestionIds.length > 0
    ? await supabase
        .from('exam_question_tag')
        .select('exam_question_id, concept_tag(id, name, concept_category_id, concept_category(id, name))')
        .in('exam_question_id', examQuestionIds)
    : { data: [] }

  const tagsByQuestionId = new Map<string, { concept_tag: { id: string; name: string; category_id: string | null; category_name: string | null } | null }[]>()
  for (const t of questionTags ?? []) {
    const row = t as any
    const qid = row.exam_question_id
    const list = tagsByQuestionId.get(qid) ?? []
    const rawTag = Array.isArray(row.concept_tag) ? row.concept_tag[0] : row.concept_tag
    const rawCat = rawTag ? (Array.isArray(rawTag.concept_category) ? rawTag.concept_category[0] : rawTag.concept_category) : null
    list.push({ concept_tag: rawTag ? {
      id: rawTag.id,
      name: rawTag.name,
      category_id: rawTag.concept_category_id ?? null,
      category_name: rawCat?.name ?? null,
    } : null })
    tagsByQuestionId.set(qid, list)
  }

  if (answersError) console.error('[share] student_answer 쿼리 에러:', answersError)
  console.log('[share] rawAnswers.length:', rawAnswers?.length, '| first exam_question:', JSON.stringify((rawAnswers?.[0] as any)?.exam_question)?.slice(0, 200))
  console.log('[share] examQuestionIds.length:', examQuestionIds.length, '| tagsByQuestionId.size:', tagsByQuestionId.size)

  const studentAnswers = (rawAnswers ?? []).map((a: any) => {
    const eq = Array.isArray(a.exam_question) ? a.exam_question[0] : a.exam_question
    return {
      ...a,
      exam_question: eq
        ? { ...eq, exam_question_tag: tagsByQuestionId.get(eq.id) ?? [] }
        : null,
    }
  })

  // 출결 데이터
  const { data: attendanceRecords } = classIds.length > 0
    ? await supabase
        .from('attendance')
        .select('id, class_id, date, status')
        .in('class_id', classIds)
        .eq('student_id', student.id)
        .order('date', { ascending: false })
    : { data: [] }

  // 주차별 반 평균 계산
  const weekById = new Map((weeks ?? []).map((w) => [w.id, w]))
  const classAverages: Record<string, { readingRate: number | null; vocabRate: number | null }> = {}
  for (const weekId of weekIds) {
    const w = weekById.get(weekId)
    if (!w) continue
    const wScores = (allWeekScores ?? []).filter((s: any) => s.week_id === weekId)
    const rRates = wScores.filter((s: any) => s.reading_correct !== null && w.reading_total > 0)
      .map((s: any) => (s.reading_correct / w.reading_total) * 100)
    const vRates = wScores.filter((s: any) => s.vocab_correct !== null && w.vocab_total > 0)
      .map((s: any) => (s.vocab_correct / w.vocab_total) * 100)
    classAverages[weekId] = {
      readingRate: rRates.length > 0 ? Math.round(rRates.reduce((a: number, b: number) => a + b, 0) / rRates.length) : null,
      vocabRate: vRates.length > 0 ? Math.round(vRates.reduce((a: number, b: number) => a + b, 0) / vRates.length) : null,
    }
  }

  return NextResponse.json({
    student,
    classes,
    weeks: weeks ?? [],
    weekScores: weekScores ?? [],
    studentAnswers,
    attendance: attendanceRecords ?? [],
    classAverages,
  })
}
