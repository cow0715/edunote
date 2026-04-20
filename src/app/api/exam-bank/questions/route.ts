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
  const q = url.searchParams.get('q')?.trim() || ''

  // 페이지네이션 (limit=0 또는 all=1 이면 전체 반환 — 전체 복사용)
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0))
  const limitParam = url.searchParams.get('limit')
  const all = url.searchParams.get('all') === '1'
  const limit = all ? 0 : Math.min(200, Math.max(1, Number(limitParam ?? 50)))

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
  if (!exams || exams.length === 0) return ok({ data: [], total: 0, page, limit, hasMore: false })

  const examIds = exams.map((e) => e.id)

  // 문항 조회 — 첫 페이지에서만 정확한 count, 이후엔 생략
  const wantCount = all || page === 0
  let qQuery = supabase
    .from('exam_bank_question')
    .select(
      '*, exam_bank!inner(title, exam_year, exam_month, grade, source)',
      wantCount ? { count: 'exact' } : undefined,
    )
    .in('exam_bank_id', examIds)
    // 최신 시험 우선 → 같은 시험 내 문항번호 순
    .order('exam_year', { foreignTable: 'exam_bank', ascending: false })
    .order('exam_month', { foreignTable: 'exam_bank', ascending: false })
    .order('exam_bank_id', { ascending: true })
    .order('question_number', { ascending: true })

  if (type) qQuery = qQuery.eq('question_type', type)
  if (points) qQuery = qQuery.eq('points', Number(points))
  if (difficulty) {
    const values = difficulty.split(',').map((d) => d.trim()).filter(Boolean)
    if (values.length === 1) qQuery = qQuery.eq('difficulty', values[0])
    else if (values.length > 1) qQuery = qQuery.in('difficulty', values)
  }
  if (maxCorrectRate) qQuery = qQuery.lte('correct_rate', Number(maxCorrectRate))
  if (q) {
    // 단어들을 AND 로 묶어서 풀텍스트 검색 (simple config)
    const tsQuery = q
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[\\&|!:()'"]/g, ''))
      .filter(Boolean)
      .join(' & ')
    if (tsQuery) {
      qQuery = qQuery.textSearch('tsv', tsQuery, { config: 'simple' })
    }
  }

  if (!all) {
    const from = page * limit
    const to = from + limit - 1
    qQuery = qQuery.range(from, to)
  }

  const { data, error, count } = await qQuery
  if (error) return err(error.message)

  const rows = data ?? []
  const total = wantCount ? (count ?? rows.length) : undefined
  const hasMore = all
    ? false
    : wantCount
      ? (count ?? 0) > (page + 1) * limit
      : rows.length === limit

  return ok({ data: rows, total, page, limit, hasMore })
}
