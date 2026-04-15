// 성적표 데이터 집계 유틸리티
// 서버/클라이언트 공용 순수 함수

export type PeriodType = 'monthly' | 'quarterly' | 'semester'

export interface ReportCard {
  id: string
  teacher_id: string
  student_id: string
  period_type: PeriodType
  period_start: string
  period_end: string
  period_label: string
  overall_grade: string | null
  teacher_comment: string | null
  next_focus: string | null
  summary_text: string | null
  highlighted_wrong_ids: string[]
  status: 'draft' | 'published'
  generated_at: string
  published_at: string | null
  created_at: string
  updated_at: string
}

// ── 기간 계산 ─────────────────────────────────────────────────────────────
export function getMonthlyPeriod(year: number, month: number): { start: string; end: string; label: string } {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0)
  return {
    start: toDateStr(start),
    end: toDateStr(end),
    label: `${year}년 ${month}월`,
  }
}

export function getQuarterlyPeriod(year: number, quarter: 1 | 2 | 3 | 4): { start: string; end: string; label: string } {
  const startMonth = (quarter - 1) * 3 + 1
  const start = new Date(year, startMonth - 1, 1)
  const end = new Date(year, startMonth + 2, 0)
  return {
    start: toDateStr(start),
    end: toDateStr(end),
    label: `${year}년 ${quarter}분기`,
  }
}

// 이전 기간 범위 계산 (비교용)
export function getPreviousPeriod(periodType: PeriodType, periodStart: string): { start: string; end: string; label: string } {
  const [y, m] = periodStart.split('-').map(Number)
  if (periodType === 'monthly') {
    const prevMonth = m - 1 === 0 ? 12 : m - 1
    const prevYear = m - 1 === 0 ? y - 1 : y
    return getMonthlyPeriod(prevYear, prevMonth)
  }
  if (periodType === 'quarterly') {
    const quarter = Math.floor((m - 1) / 3) + 1
    const prevQ = quarter === 1 ? 4 : (quarter - 1) as 1 | 2 | 3 | 4
    const prevY = quarter === 1 ? y - 1 : y
    return getQuarterlyPeriod(prevY, prevQ as 1 | 2 | 3 | 4)
  }
  // semester
  const semester = m >= 3 && m <= 8 ? 1 : 2
  if (semester === 1) return getSemesterPeriod(y - 1, 2)
  return getSemesterPeriod(y, 1)
}

// 학기: 1학기 = 3월~8월, 2학기 = 9월~다음해 2월
export function getSemesterPeriod(year: number, semester: 1 | 2): { start: string; end: string; label: string } {
  if (semester === 1) {
    return {
      start: toDateStr(new Date(year, 2, 1)),       // 3월 1일
      end: toDateStr(new Date(year, 7, 31)),        // 8월 31일
      label: `${year}년 1학기`,
    }
  }
  return {
    start: toDateStr(new Date(year, 8, 1)),          // 9월 1일
    end: toDateStr(new Date(year + 1, 1, 28 + (isLeap(year + 1) ? 1 : 0))), // 다음해 2월 말
    label: `${year}년 2학기`,
  }
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

// ── 지표 계산 ─────────────────────────────────────────────────────────────
export interface WeekRow {
  week_id: string
  week_number: number
  start_date: string | null
  class_name: string
  reading_rate: number | null
  vocab_rate: number | null
  homework_rate: number | null
  reading_correct: number | null
  reading_total: number
  vocab_correct: number | null
  vocab_total: number
  homework_done: number | null
  homework_total: number
}

export interface CategoryStat {
  tag_id: string | null
  name: string
  category_name: string | null
  correct: number
  total: number
  wrong: number
  rate: number
}

export interface BestWeek {
  week_number: number
  overall_rate: number
}

export interface PeriodComparison {
  label: string
  overallAvg: number | null
  avgReading: number | null
  avgVocab: number | null
  avgHomework: number | null
}

export interface WrongItem {
  answer_id: string
  week_number: number
  question_number: number
  sub_label: string | null
  exam_type: 'reading' | 'vocab' | null
  question_style: string
  question_text: string | null
  my_answer: string
  correct_answer: string
  explanation: string | null
  tags: string[]
}

export interface ReportMetrics {
  weekRows: WeekRow[]
  avgReading: number | null
  avgVocab: number | null
  avgHomework: number | null
  overallAvg: number | null
  attendancePresent: number
  attendanceTotal: number
  strengths: CategoryStat[]     // top 3 (소분류 태그 기준)
  weaknesses: CategoryStat[]    // bottom 3 (소분류 태그 기준, wrong 포함)
  wrongItems: WrongItem[]
  totalQuestions: number
  totalCorrect: number
  bestWeek: BestWeek | null
}

type WeekLite = {
  id: string
  class_id: string
  week_number: number
  start_date: string | null
  reading_total: number
  vocab_total: number
  homework_total: number
}
type ScoreLite = {
  id: string
  week_id: string
  reading_correct: number | null
  vocab_correct: number | null
  homework_done: number | null
}
type AnswerLite = {
  id: string
  week_score_id: string
  is_correct: boolean
  student_answer: number | null
  student_answer_text: string | null
  exam_question: {
    id: string
    week_id: string
    question_number: number
    sub_label: string | null
    exam_type: 'reading' | 'vocab' | null
    question_style: string
    correct_answer: number | null
    correct_answer_text: string | null
    explanation: string | null
    question_text: string | null
    exam_question_tag: { concept_tag: { id: string; name: string; category_id: string | null; category_name: string | null } | null }[]
  } | null
}

const CIRCLE = ['①', '②', '③', '④', '⑤']

function rate(correct: number | null, total: number): number | null {
  if (correct === null || total === 0) return null
  return Math.round((correct / total) * 100)
}

export function computeMetrics(
  weeks: WeekLite[],
  scores: ScoreLite[],
  answers: AnswerLite[],
  attendance: { status: 'present' | 'late' | 'absent' }[],
  classNameById: Map<string, string>,
): ReportMetrics {
  const scoreByWeek = new Map(scores.map((s) => [s.week_id, s]))
  const scoreById = new Map(scores.map((s) => [s.id, s]))

  const weekRows: WeekRow[] = weeks
    .sort((a, b) => a.week_number - b.week_number)
    .map((w) => {
      const s = scoreByWeek.get(w.id)
      return {
        week_id: w.id,
        week_number: w.week_number,
        start_date: w.start_date,
        class_name: classNameById.get(w.class_id) ?? '',
        reading_rate: s ? rate(s.reading_correct, w.reading_total) : null,
        vocab_rate: s ? rate(s.vocab_correct, w.vocab_total) : null,
        homework_rate: s ? rate(s.homework_done, w.homework_total) : null,
        reading_correct: s?.reading_correct ?? null,
        reading_total: w.reading_total,
        vocab_correct: s?.vocab_correct ?? null,
        vocab_total: w.vocab_total,
        homework_done: s?.homework_done ?? null,
        homework_total: w.homework_total,
      }
    })

  const avg = (arr: (number | null)[]): number | null => {
    const nums = arr.filter((v): v is number => v !== null)
    if (nums.length === 0) return null
    return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
  }

  const avgReading = avg(weekRows.map((r) => r.reading_rate))
  const avgVocab = avg(weekRows.map((r) => r.vocab_rate))
  const avgHomework = avg(weekRows.map((r) => r.homework_rate))
  const overallAvg = avg([avgReading, avgVocab, avgHomework])

  const attendancePresent = attendance.filter((a) => a.status !== 'absent').length
  const attendanceTotal = attendance.length

  // 태그별(소분류) 정답률 집계 — reading 위주
  const tagMap = new Map<string, CategoryStat>()
  let totalQuestions = 0
  let totalCorrect = 0
  for (const a of answers) {
    const q = a.exam_question
    if (!q) continue
    totalQuestions++
    if (a.is_correct) totalCorrect++
    if (q.exam_type !== 'reading') continue
    for (const t of q.exam_question_tag ?? []) {
      const tag = t.concept_tag
      if (!tag?.name) continue
      const key = tag.id ?? tag.name
      const entry = tagMap.get(key) ?? {
        tag_id: tag.id,
        name: tag.name,
        category_name: tag.category_name,
        correct: 0,
        total: 0,
        wrong: 0,
        rate: 0,
      }
      entry.total++
      if (a.is_correct) entry.correct++
      else entry.wrong++
      tagMap.set(key, entry)
    }
  }
  const tags = [...tagMap.values()]
    .map((c) => ({ ...c, rate: c.total > 0 ? Math.round((c.correct / c.total) * 100) : 0 }))
    .filter((c) => c.total >= 3)

  const strengths = [...tags].sort((a, b) => b.rate - a.rate || b.total - a.total).slice(0, 3)
  const weaknesses = [...tags].filter((c) => c.wrong > 0).sort((a, b) => a.rate - b.rate || b.wrong - a.wrong).slice(0, 3)

  // 최고 주차 (3영역 평균 기준)
  const weekScored = weekRows
    .map((r) => {
      const vals = [r.reading_rate, r.vocab_rate, r.homework_rate].filter((v): v is number => v !== null)
      if (vals.length === 0) return null
      return { week_number: r.week_number, overall_rate: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }
    })
    .filter((v): v is BestWeek => v !== null)
  const bestWeek = weekScored.length > 0
    ? weekScored.reduce((best, cur) => (cur.overall_rate > best.overall_rate ? cur : best))
    : null

  const weekById = new Map(weeks.map((w) => [w.id, w]))
  const wrongItems: WrongItem[] = answers
    .filter((a) => !a.is_correct && a.exam_question)
    .map((a): WrongItem => {
      const q = a.exam_question!
      const score = scoreById.get(a.week_score_id)
      const w = score ? weekById.get(score.week_id) : undefined
      const myAnswer =
        q.question_style === 'objective'
          ? a.student_answer !== null ? (CIRCLE[a.student_answer - 1] ?? String(a.student_answer)) : '미작성'
          : (a.student_answer_text?.trim() || '미작성')
      const correctAnswer =
        q.question_style === 'objective'
          ? q.correct_answer !== null ? (CIRCLE[q.correct_answer - 1] ?? String(q.correct_answer)) : '?'
          : (q.correct_answer_text ?? '?')
      return {
        answer_id: a.id,
        week_number: w?.week_number ?? 0,
        question_number: q.question_number,
        sub_label: q.sub_label,
        exam_type: q.exam_type,
        question_style: q.question_style,
        question_text: q.question_text,
        my_answer: myAnswer,
        correct_answer: correctAnswer,
        explanation: q.explanation,
        tags: (q.exam_question_tag ?? [])
          .map((t) => t.concept_tag?.name)
          .filter((n): n is string => !!n),
      }
    })
    .sort((a, b) => a.week_number - b.week_number || a.question_number - b.question_number)

  return {
    weekRows,
    avgReading,
    avgVocab,
    avgHomework,
    overallAvg,
    attendancePresent,
    attendanceTotal,
    strengths,
    weaknesses,
    wrongItems,
    totalQuestions,
    totalCorrect,
    bestWeek,
  }
}

// ── 자동 요약 문장 생성 ───────────────────────────────────────────────────
export function buildAutoSummary(
  studentName: string,
  metrics: ReportMetrics,
  previous: PeriodComparison | null,
): string {
  const parts: string[] = []

  if (metrics.overallAvg !== null && previous?.overallAvg !== null && previous) {
    const diff = metrics.overallAvg - (previous.overallAvg ?? 0)
    if (Math.abs(diff) >= 3) {
      parts.push(`전 기간 대비 평균 정답률이 ${diff > 0 ? '+' : ''}${diff}점 ${diff > 0 ? '상승했습니다' : '하락했습니다'}.`)
    } else {
      parts.push(`전 기간과 비슷한 수준을 유지했습니다.`)
    }
  } else if (metrics.overallAvg !== null) {
    parts.push(`이번 기간 평균 정답률은 ${metrics.overallAvg}%입니다.`)
  }

  if (metrics.strengths[0]) {
    parts.push(`${metrics.strengths[0].name} 영역에서 강점을 보였고`)
  }
  if (metrics.weaknesses[0]) {
    parts.push(`${metrics.weaknesses[0].name} 영역은 추가 연습이 필요합니다.`)
  }

  const attendRate = metrics.attendanceTotal > 0
    ? Math.round((metrics.attendancePresent / metrics.attendanceTotal) * 100)
    : null
  if (attendRate !== null && attendRate < 80) {
    parts.push(`출석률 ${attendRate}%로 꾸준한 참여가 필요합니다.`)
  }

  return parts.length > 0 ? `${studentName} 학생은 ${parts.join(' ')}` : ''
}

// ── 등급 자동 제안 ────────────────────────────────────────────────────────
export function suggestGrade(overallAvg: number | null): string {
  if (overallAvg === null) return '-'
  if (overallAvg >= 90) return 'A'
  if (overallAvg >= 80) return 'B'
  if (overallAvg >= 70) return 'C'
  return 'D'
}
