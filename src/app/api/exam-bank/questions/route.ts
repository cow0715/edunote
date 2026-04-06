import { getAuth, getTeacherId, err, ok } from '@/lib/api'

// GET — 기출문제 통합 검색
// ?type=blank_vocabulary&grade=3&year_from=2024&year_to=2026&source=평가원
// &points=3&difficulty=중상,최상&max_correct_rate=50
export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const grade = url.searchParams.get('grade')
  const yearFrom = url.searchParams.get('year_from')
  const yearTo = url.searchParams.get('year_to')
  const source = url.searchParams.get('source')
  const month = url.searchParams.get('month')
  const points = url.searchParams.get('points')
  const difficulty = url.searchParams.get('difficulty') // 쉼표 구분 다중값
  const maxCorrectRate = url.searchParams.get('max_correct_rate')

  // 소유한 exam_bank id 목록 조회
  let examQuery = supabase
    .from('exam_bank')
    .select('id')
    .eq('teacher_id', teacherId)

  if (grade) examQuery = examQuery.eq('grade', Number(grade))
  if (yearFrom) examQuery = examQuery.gte('exam_year', Number(yearFrom))
  if (yearTo) examQuery = examQuery.lte('exam_year', Number(yearTo))
  if (source) examQuery = examQuery.eq('source', source)
  if (month) examQuery = examQuery.eq('exam_month', Number(month))

  const { data: exams, error: examError } = await examQuery
  if (examError) return err(examError.message)
  if (!exams || exams.length === 0) return ok([])

  const examIds = exams.map((e) => e.id)

  // 문항 조회
  let qQuery = supabase
    .from('exam_bank_question')
    .select('*, exam_bank!inner(title, exam_year, exam_month, grade, source)')
    .in('exam_bank_id', examIds)
    .order('question_number')

  if (type) qQuery = qQuery.eq('question_type', type)
  if (points) qQuery = qQuery.eq('points', Number(points))
  if (difficulty) {
    const values = difficulty.split(',').map((d) => d.trim()).filter(Boolean)
    if (values.length === 1) qQuery = qQuery.eq('difficulty', values[0])
    else if (values.length > 1) qQuery = qQuery.in('difficulty', values)
  }
  if (maxCorrectRate) qQuery = qQuery.lte('correct_rate', Number(maxCorrectRate))

  const { data, error } = await qQuery
  if (error) return err(error.message)
  return ok(data)
}
