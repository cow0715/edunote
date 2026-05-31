import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { assertMockExamOwner } from '@/lib/mock-exam-server'

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

type SupabaseClient = Awaited<ReturnType<typeof getAuth>>['supabase']

type ResultForSnapshot = {
  id: string
  mock_exam_id: string
  student_id: string
  raw_score: number | null
  grade: number | null
  listening_correct: number
  listening_total: number
  reading_correct: number
  reading_total: number
  type_analysis: Record<string, unknown>
  teacher_comment: string | null
  student?: { id: string; name: string; school: string | null; grade: string | null } | { id: string; name: string; school: string | null; grade: string | null }[] | null
  mock_exam?: { id: string; title: string; exam_year: number; exam_month: number; grade: number | null; source: string; exam_date: string | null } | { id: string; title: string; exam_year: number; exam_month: number; grade: number | null; source: string; exam_date: string | null }[] | null
  mock_exam_student_answer?: {
    student_answer: string | null
    is_correct: boolean
    earned_points: number
    mock_exam_question?: {
      question_number: number
      correct_answer: string
      points: number
      section: string
      question_type: string
      difficulty: string
      is_void: boolean
      all_correct: boolean
    } | {
      question_number: number
      correct_answer: string
      points: number
      section: string
      question_type: string
      difficulty: string
      is_void: boolean
      all_correct: boolean
    }[] | null
  }[]
}

type ResultRankRow = {
  id: string
  raw_score: number | null
}

function buildRankSnapshot(rows: ResultRankRow[], resultId: string, rawScore: number | null) {
  const scoredRows = rows.filter((row) => row.raw_score != null)
  if (rawScore == null || scoredRows.length === 0) {
    return {
      rank: null,
      total: scoredRows.length,
      average_score: null,
      top_score: null,
      same_score_count: 0,
      percentile: null,
    }
  }

  const scores = scoredRows.map((row) => Number(row.raw_score))
  const rank = scores.filter((score) => score > rawScore).length + 1
  const lowerCount = scores.filter((score) => score < rawScore).length
  const targetScoreCount = scoredRows.filter((row) => row.id === resultId).length
  const sameScoreCount = scores.filter((score) => score === rawScore).length

  return {
    rank,
    total: scoredRows.length,
    average_score: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    top_score: Math.max(...scores),
    same_score_count: targetScoreCount > 0 ? sameScoreCount : 0,
    percentile: Math.round((lowerCount / scoredRows.length) * 100),
  }
}

async function publishMockExamReport(supabase: SupabaseClient, mockExamId: string, resultId: string) {
  const { data, error } = await supabase
    .from('mock_exam_result')
    .select(`
      *,
      student(id, name, school, grade),
      mock_exam(id, title, exam_year, exam_month, grade, source, exam_date),
      mock_exam_student_answer(
        student_answer, is_correct, earned_points,
        mock_exam_question(question_number, correct_answer, points, section, question_type, difficulty, is_void, all_correct)
      )
    `)
    .eq('id', resultId)
    .eq('mock_exam_id', mockExamId)
    .single()

  if (error || !data) throw new Error(error?.message ?? '성적 결과를 찾을 수 없습니다')

  const result = data as unknown as ResultForSnapshot
  const exam = one(result.mock_exam)
  const student = one(result.student)
  if (!exam || !student) throw new Error('성적표 링크 생성에 필요한 정보가 부족합니다')

  const wrongAnswers = (result.mock_exam_student_answer ?? [])
    .map((answer) => ({
      ...answer,
      mock_exam_question: one(answer.mock_exam_question),
    }))
    .filter((answer) => answer.mock_exam_question && !answer.mock_exam_question.is_void && !answer.is_correct)
    .sort((a, b) => (a.mock_exam_question?.question_number ?? 0) - (b.mock_exam_question?.question_number ?? 0))

  const { data: rankRows, error: rankError } = await supabase
    .from('mock_exam_result')
    .select('id, raw_score')
    .eq('mock_exam_id', mockExamId)
    .not('raw_score', 'is', null)

  if (rankError) throw new Error(rankError.message)

  const snapshot = {
    version: 1,
    generated_at: new Date().toISOString(),
    exam,
    student,
    score: {
      raw_score: result.raw_score,
      grade: result.grade,
      listening_correct: result.listening_correct,
      listening_total: result.listening_total,
      reading_correct: result.reading_correct,
      reading_total: result.reading_total,
      type_analysis: result.type_analysis,
    },
    cohort: buildRankSnapshot((rankRows ?? []) as ResultRankRow[], result.id, result.raw_score),
    wrong_answers: wrongAnswers,
    teacher_comment: result.teacher_comment,
  }

  const { data: report, error: reportError } = await supabase
    .from('mock_exam_report')
    .upsert({
      mock_exam_result_id: result.id,
      snapshot_json: snapshot,
      status: 'published',
      published_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: 'mock_exam_result_id' })
    .select()
    .single()

  if (reportError) throw new Error(reportError.message)

  await supabase
    .from('mock_exam_result')
    .update({ status: 'published', published_at: report.published_at })
    .eq('id', result.id)

  return report
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증이 필요합니다', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const body = await request.json().catch(() => ({})) as { result_id?: string; result_ids?: string[] }
  const resultIds = Array.isArray(body.result_ids)
    ? [...new Set(body.result_ids.filter((resultId) => typeof resultId === 'string' && resultId))]
    : []

  try {
    if (resultIds.length > 0) {
      const reports = []
      for (const resultId of resultIds) {
        reports.push(await publishMockExamReport(supabase, id, resultId))
      }
      return ok({ reports, published_count: reports.length })
    }

    if (!body.result_id) return err('성적 결과를 선택해 주세요')
    const report = await publishMockExamReport(supabase, id, body.result_id)
    return ok(report)
  } catch (error) {
    return err(error instanceof Error ? error.message : '성적표 발행 실패', 500)
  }
}
