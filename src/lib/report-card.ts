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

export interface ClassContext {
  classAvgOverall: number | null
  classAvgReading: number | null
  classAvgVocab: number | null
  classAvgHomework: number | null
  classAvgWriting: number | null     // 독해 서술형(작문) 반 평균
  classTotalStudents: number
  classRank: number | null           // 1-based; null if not computable
  classPercentile: number | null     // 상위 몇 %
  // 문항별 반 정답률: key = exam_question_id
  questionAccuracy: Record<string, { correct: number; total: number }>
}

export interface AcademyProfile {
  name: string | null
  english_name: string | null
  address: string | null
  phone: string | null
  director_name: string | null
  teacher_name: string | null
}

// 정성 라벨
export function qualitativeLabel(rate: number | null): string {
  if (rate === null) return '-'
  if (rate >= 95) return '최우수'
  if (rate >= 85) return '우수'
  if (rate >= 70) return '양호'
  if (rate >= 55) return '보통'
  return '노력'
}

export function qualitativeColor(rate: number | null): string {
  if (rate === null) return '#9CA3AF'
  if (rate >= 85) return '#2463EB'
  if (rate >= 70) return '#10B981'
  if (rate >= 55) return '#F59E0B'
  return '#EF4444'
}

export interface WrongItem {
  answer_id: string
  exam_question_id: string
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
  avgReading: number | null   // 독해 객관식
  avgWriting: number | null   // 독해 서술형(작문)
  avgVocab: number | null
  avgHomework: number | null
  overallAvg: number | null
  attendancePresent: number   // 출석(present)만
  attendanceLate: number
  attendanceAbsent: number
  attendanceTotal: number
  strengths: CategoryStat[]     // top 3 (소분류 태그 기준)
  weaknesses: CategoryStat[]    // bottom 3 (소분류 태그 기준, wrong 포함)
  categoryStats: CategoryStat[] // 중분류별 정답률 (오름차순)
  wrongItems: WrongItem[]
  totalQuestions: number
  totalCorrect: number
  bestWeek: BestWeek | null
  achievements: string[]        // 이 기간의 성취 내러티브 배지
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

  // 작문(서술형 독해) 별도 집계 — answer 레벨에서 question_style='subjective' 필터
  const writingAnswers = answers.filter(
    (a) => a.exam_question?.exam_type === 'reading' && a.exam_question?.question_style === 'subjective'
  )
  const avgWriting: number | null = writingAnswers.length >= 1
    ? Math.round(writingAnswers.filter((a) => a.is_correct).length / writingAnswers.length * 100)
    : null

  const attendancePresent = attendance.filter((a) => a.status === 'present').length
  const attendanceLate = attendance.filter((a) => a.status === 'late').length
  const attendanceAbsent = attendance.filter((a) => a.status === 'absent').length
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

  // 중분류별 정답률 집계
  const categoryMap = new Map<string, CategoryStat>()
  for (const tag of tagMap.values()) {
    if (!tag.category_name) continue
    const entry = categoryMap.get(tag.category_name) ?? {
      tag_id: null, name: tag.category_name, category_name: null,
      correct: 0, total: 0, wrong: 0, rate: 0,
    }
    entry.correct += tag.correct
    entry.total += tag.total
    entry.wrong += tag.wrong
    categoryMap.set(tag.category_name, entry)
  }
  const categoryStats: CategoryStat[] = [...categoryMap.values()]
    .map((c) => ({ ...c, rate: c.total > 0 ? Math.round((c.correct / c.total) * 100) : 0 }))
    .filter((c) => c.total >= 2)
    .sort((a, b) => a.rate - b.rate)

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
        exam_question_id: q.id,
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

  // 성취 배지 (내러티브)
  const achievements: string[] = []
  if (weekScored.length >= 2) {
    let curRun = 1
    let maxRun = 1
    for (let i = 1; i < weekScored.length; i++) {
      if (weekScored[i].overall_rate > weekScored[i - 1].overall_rate) {
        curRun++
        if (curRun > maxRun) maxRun = curRun
      } else {
        curRun = 1
      }
    }
    if (maxRun >= 3) achievements.push(`${maxRun}주 연속 점수 상승`)
  }
  if (bestWeek && bestWeek.overall_rate >= 90) {
    achievements.push(`최고 주차 ${bestWeek.overall_rate}% 달성`)
  }
  if (attendanceTotal > 0 && attendanceAbsent === 0 && attendanceLate === 0) {
    achievements.push(`개근 (${attendanceTotal}회 전체 출석)`)
  }
  if (totalQuestions >= 100) {
    achievements.push(`${totalQuestions}문항 풀이 완료`)
  }
  if (totalQuestions >= 20) {
    const r = Math.round((totalCorrect / totalQuestions) * 100)
    if (r >= 85) achievements.push(`평균 정답률 ${r}%`)
  }
  if (overallAvg !== null && overallAvg >= 95) {
    achievements.push('종합 평균 95% 이상')
  }

  return {
    weekRows,
    avgReading,
    avgWriting,
    avgVocab,
    avgHomework,
    overallAvg,
    attendancePresent,
    attendanceLate,
    attendanceAbsent,
    attendanceTotal,
    strengths,
    weaknesses,
    categoryStats,
    wrongItems,
    totalQuestions,
    totalCorrect,
    bestWeek,
    achievements,
  }
}

// ── 자동 요약 문장 생성 ───────────────────────────────────────────────────
export function buildAutoSummary(
  studentName: string,
  metrics: ReportMetrics,
  previous: PeriodComparison | null,
  classContext?: ClassContext | null,
): string {
  const parts: string[] = []
  const weeks = metrics.weekRows.length

  // 1. 종합 성적 + 전 기간 비교
  if (metrics.overallAvg !== null) {
    const delta = previous?.overallAvg != null ? metrics.overallAvg - previous.overallAvg : null
    if (delta !== null && Math.abs(delta) >= 2) {
      const dir = delta > 0 ? `${delta}점 상승` : `${Math.abs(delta)}점 하락`
      parts.push(`이번 기간(${weeks > 0 ? `${weeks}주` : '이번 기간'}) ${studentName} 학생의 종합 평균은 ${metrics.overallAvg}%로, 지난 기간(${previous!.overallAvg}%)보다 ${dir}했습니다.`)
    } else {
      parts.push(`이번 기간(${weeks > 0 ? `${weeks}주` : '이번 기간'}) ${studentName} 학생의 종합 평균은 ${metrics.overallAvg}%입니다.`)
    }
  }

  // 2. 영역별 강점/약점 (구체적 수치 포함)
  type D = { name: string; rate: number | null; classAvg: number | null | undefined }
  const domains: D[] = [
    { name: '독해', rate: metrics.avgReading, classAvg: classContext?.classAvgReading },
    ...(metrics.avgWriting !== null ? [{ name: '작문', rate: metrics.avgWriting, classAvg: classContext?.classAvgWriting }] : []),
    { name: '어휘', rate: metrics.avgVocab, classAvg: classContext?.classAvgVocab },
    { name: '과제', rate: metrics.avgHomework, classAvg: classContext?.classAvgHomework },
  ]
  const scored = domains.filter(d => d.rate !== null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))

  if (scored.length > 0) {
    const best = scored[0]
    const worst = scored[scored.length - 1]

    if ((best.rate ?? 0) >= 75) {
      const aboveClass = best.classAvg != null ? (best.rate ?? 0) - best.classAvg : null
      if (aboveClass !== null && aboveClass >= 3) {
        parts.push(`특히 ${best.name} 영역에서 ${best.rate}%를 기록해 반 평균(${best.classAvg}%)보다 ${aboveClass}점 높은 성과를 보였습니다.`)
      } else if (scored.length >= 2 && (scored[1].rate ?? 0) >= 75) {
        parts.push(`${best.name}(${best.rate}%)과 ${scored[1].name}(${scored[1].rate}%)이 강점 영역입니다.`)
      } else {
        parts.push(`${best.name}(${best.rate}%)이 가장 높은 성과를 보인 영역입니다.`)
      }
    }

    if (worst.name !== best.name && (worst.rate ?? 100) < 75) {
      const aboveClass = worst.classAvg != null ? (worst.rate ?? 0) - worst.classAvg : null
      if (aboveClass !== null && aboveClass < -5) {
        parts.push(`${worst.name}(${worst.rate}%)은 반 평균(${worst.classAvg}%)보다 ${Math.abs(aboveClass)}점 낮아 집중적인 보완이 필요합니다.`)
      } else {
        parts.push(`${worst.name}(${worst.rate}%)은 상대적으로 더 연습이 필요한 영역입니다.`)
      }
    }
  }

  // 3. 반 석차
  if (classContext?.classRank && classContext.classTotalStudents) {
    const streak = metrics.achievements.find(a => /\d+주 연속 점수 상승/.test(a))
    if (streak) {
      parts.push(`${streak}을 이어가며 반 ${classContext.classTotalStudents}명 중 ${classContext.classRank}위를 기록했습니다.`)
    } else {
      parts.push(`현재 반 ${classContext.classTotalStudents}명 중 ${classContext.classRank}위입니다.`)
    }
  } else if (metrics.achievements.length > 0) {
    const streak = metrics.achievements.find(a => /\d+주 연속 점수 상승/.test(a))
    if (streak) parts.push(`${streak}을 이어가고 있습니다.`)
  }

  // 4. 출석 (주목할 만한 경우만)
  const attended = metrics.attendancePresent + metrics.attendanceLate
  const attendRate = metrics.attendanceTotal > 0
    ? Math.round((attended / metrics.attendanceTotal) * 100)
    : null
  if (attendRate !== null && attendRate === 100) {
    parts.push(`이번 기간 개근하며 꾸준히 수업에 참여한 점이 돋보입니다.`)
  } else if (attendRate !== null && attendRate < 80) {
    parts.push(`출석률이 ${attendRate}%로, 더 꾸준한 참여가 학습 성과 향상에 도움이 될 것입니다.`)
  }

  return parts.join(' ')
}

// ── 등급 자동 제안 ────────────────────────────────────────────────────────
export function suggestGrade(overallAvg: number | null): string {
  if (overallAvg === null) return '-'
  if (overallAvg >= 90) return 'A'
  if (overallAvg >= 80) return 'B'
  if (overallAvg >= 70) return 'C'
  return 'D'
}
