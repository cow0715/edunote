import type { StudentAnswer, Week } from '@/app/share/[token]/share-types'
import { wrongRateScore, type WrongTypeStat } from './wrong-rate'

/** Product evidence thresholds; they do not establish statistical certainty. */
export const ANALYSIS_MIN_QUESTIONS = 10
export const ANALYSIS_MIN_APPEARANCES = 3
export const ANALYSIS_RECENT_APPEARANCES = 4

/** Describes recorded results within a supplied scope, rather than fixed ability. */
export type AnalysisStatus = 'priority' | 'review' | 'stable' | 'insufficient'
export const ANALYSIS_STATUS_LABELS: Record<AnalysisStatus, string> = {
  priority: '우선 보완', review: '복습 권장', stable: '안정적', insufficient: '기록 부족',
}
export const ANALYSIS_STATUS_DESCRIPTIONS: Record<AnalysisStatus, string> = {
  priority: '선택한 기간의 누적 정답률이 60% 미만인 유형이에요. 3회 이상 출제되고 10문항 이상 기록돼야 분류해요.',
  review: '선택한 기간의 누적 정답률이 60% 이상, 80% 미만인 유형이에요. 남은 오답을 복습해요.',
  stable: '선택한 기간의 누적 정답률이 80% 이상인 유형이에요. 최근 결과는 따로 확인해요.',
  insufficient: '선택한 기간에 3회 출제·10문항 중 하나라도 부족해 약점 판단을 보류해요. 기록된 오답은 확인할 수 있어요.',
}
const STATUS_ORDER: Record<AnalysisStatus, number> = { priority: 0, review: 1, insufficient: 2, stable: 3 }

export type AnalysisPoint = {
  weekId: string
  correct: number
  total: number
  rate: number
}
/** A question-weighted result for one stated period or appearance window. */
export type AnalysisWindow = { correct: number; total: number; wrong: number; rate: number }
export type AnalysisType = WrongTypeStat & {
  points: AnalysisPoint[]
  cumulative: AnalysisWindow
  recent: AnalysisWindow
  previous: AnalysisWindow | null
  recentCount: number
  previousCount: number
  trendComparable: boolean
  /** Recent minus previous accuracy, in percentage points; insufficient comparisons are withheld. */
  change: number | null
  wrongAppearances: number
  status: AnalysisStatus
  recentStatus: AnalysisStatus
  reason: string
}
export type AnalysisConcentration = {
  typeIds: string[]
  names: string[]
  /** Unique wrong answers containing at least one selected type. */
  wrong: number
  totalWrong: number
  share: number
}
export type ShareAnalysisSummary = {
  types: AnalysisType[]
  priorities: AnalysisType[]
  focus: AnalysisType | null
  headline: string
  description: string
  wrongCount: number
  untaggedCount: number
  readingCount: number
  weekCount: number
  trends: AnalysisType[]
  concentration: AnalysisConcentration | null
  improvement: AnalysisType | null
  strength: AnalysisType | null
  statusCounts: Record<AnalysisStatus, number>
}

function combinePoints(points: AnalysisPoint[]): AnalysisWindow {
  const correct = points.reduce((sum, point) => sum + point.correct, 0)
  const total = points.reduce((sum, point) => sum + point.total, 0)
  return { correct, total, wrong: total - correct, rate: total > 0 ? Math.round(correct / total * 100) : 0 }
}

function hasEnoughEvidence(window: AnalysisWindow, appearances: number): boolean {
  return window.total >= ANALYSIS_MIN_QUESTIONS && appearances >= ANALYSIS_MIN_APPEARANCES
}

/** The 15pp boundary uses raw ratios so display rounding never changes the judgment. */
function hasMeaningfulDecline(type: Pick<AnalysisType, 'recent' | 'previous' | 'trendComparable'>): boolean {
  const { recent, previous, trendComparable } = type
  return trendComparable && previous !== null
    && (recent.correct * previous.total - previous.correct * recent.total) * 100
      <= -15 * recent.total * previous.total
}

function classifyStatus(window: AnalysisWindow, appearances: number): AnalysisStatus {
  if (!hasEnoughEvidence(window, appearances)) return 'insufficient'
  if (window.correct * 100 >= window.total * 80) return 'stable'
  if (window.correct * 100 < window.total * 60) return 'priority'
  return 'review'
}

function compareCumulativeResults(a: AnalysisType, b: AnalysisType): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || wrongRateScore(b.wrong, b.total) - wrongRateScore(a.wrong, a.total)
    || b.wrongAppearances - a.wrongAppearances
    || b.total - a.total
    || a.name.localeCompare(b.name, 'ko-KR')
}

function compareRecommendations(a: AnalysisType, b: AnalysisType): number {
  const recentConcernA = a.status === 'stable' && a.recentStatus === 'priority'
  const recentConcernB = b.status === 'stable' && b.recentStatus === 'priority'
  if (recentConcernA !== recentConcernB) return Number(recentConcernB) - Number(recentConcernA)
  if (recentConcernA && recentConcernB) {
    return wrongRateScore(b.recent.wrong, b.recent.total) - wrongRateScore(a.recent.wrong, a.recent.total)
      || compareCumulativeResults(a, b)
  }
  return compareCumulativeResults(a, b)
}

function describePriority(type: Omit<AnalysisType, 'reason'>): string {
  const { cumulative, recent, previous, recentCount, change, wrongAppearances, status, recentStatus } = type
  const evidence = `이 기간 ${type.points.length}회 출제에서 ${cumulative.total}문항 중 ${cumulative.wrong}문항을 틀렸어요. 누적 정답률은 ${cumulative.rate}%예요.`
  if (status === 'insufficient') return `${evidence} 아직 3회 출제·10문항 기준을 충족하지 않아 약점 판단은 보류해요. 기록된 오답부터 확인해요.`
  if ((status === 'priority' || status === 'review') && recentStatus === 'stable') {
    return `${evidence} 최근 ${recentCount}회 출제에서는 ${recent.total}문항 중 ${recent.correct}문항을 맞혀 정답률 ${recent.rate}%로 안정적이에요. 이전 오답을 확인해요.`
  }
  if (status === 'stable' && recentStatus === 'priority') {
    return `${evidence} 최근 ${recentCount}회 출제에서는 ${recent.total}문항 중 ${recent.wrong}문항을 틀려 정답률이 ${recent.rate}%예요. 최근 오답의 정답 근거를 확인해요.`
  }
  if (recent.wrong === 0) return `${evidence} 최근 ${recentCount}회 출제의 ${recent.total}문항은 모두 맞혔어요. 이전 오답을 함께 확인해요.`
  if (status === 'stable') return `${evidence} 이 기간의 남은 오답 ${cumulative.wrong}문항을 확인해요.`
  const decline = previous && hasMeaningfulDecline(type) && change !== null
    ? `직전 ${previous.total}문항의 정답률 ${previous.rate}%에서 최근 ${recent.rate}%로 ${Math.abs(change)}%p 낮아졌어요. `
    : ''
  return `${evidence} ${decline}${wrongAppearances >= 2
    ? `이 기간 ${type.points.length}회 출제 중 ${wrongAppearances}회에서 오답이 확인돼 복습을 권해요.`
    : '틀린 문제의 근거를 먼저 확인해요.'}`
}

/** Only supplied-period reading answers are counted. A type is counted once per answer. */
export function buildShareAnalysis(answers: StudentAnswer[], weeks: Week[]): ShareAnalysisSummary {
  const weekIds = new Set(weeks.map((week) => week.id))
  const reading = answers.filter((answer) => answer.exam_question?.exam_type === 'reading'
    && weekIds.has(answer.exam_question.week_id))
  const orderedWeeks = [...weeks].sort((a, b) =>
    (a.start_date ?? '').localeCompare(b.start_date ?? '') || a.week_number - b.week_number || a.id.localeCompare(b.id))
  const byType = new Map<string, WrongTypeStat & { byWeek: Map<string, AnalysisPoint> }>()
  let untaggedCount = 0
  for (const answer of reading) {
    const question = answer.exam_question!
    const seen = new Set<string>()
    for (const { concept_tag: tag } of question.exam_question_tag) {
      if (!tag || seen.has(tag.id)) continue
      seen.add(tag.id)
      const stat = byType.get(tag.id) ?? { id: tag.id, name: tag.name, wrong: 0, total: 0, byWeek: new Map<string, AnalysisPoint>() }
      stat.total++
      if (!answer.is_correct) stat.wrong++
      const point = stat.byWeek.get(question.week_id) ?? { weekId: question.week_id, correct: 0, total: 0, rate: 0 }
      point.total++
      if (answer.is_correct) point.correct++
      point.rate = Math.round(point.correct / point.total * 100)
      stat.byWeek.set(question.week_id, point)
      byType.set(tag.id, stat)
    }
    if (seen.size === 0) untaggedCount++
  }
  const types: AnalysisType[] = [...byType.values()].map(({ byWeek, ...stat }) => {
    const points = orderedWeeks.flatMap((week) => byWeek.has(week.id) ? [byWeek.get(week.id)!] : [])
    const cumulative = combinePoints(points)
    const recentPoints = points.slice(-ANALYSIS_RECENT_APPEARANCES)
    const recent = combinePoints(recentPoints)
    const previousPoints = points.slice(Math.max(0, points.length - ANALYSIS_RECENT_APPEARANCES * 2), Math.max(0, points.length - ANALYSIS_RECENT_APPEARANCES))
    const previous = previousPoints.length > 0 ? combinePoints(previousPoints) : null
    const trendComparable = previous !== null && hasEnoughEvidence(recent, recentPoints.length)
      && hasEnoughEvidence(previous, previousPoints.length)
    const type = {
      ...stat, points, cumulative, recent, previous,
      recentCount: recentPoints.length, previousCount: previousPoints.length, trendComparable,
      change: trendComparable && previous ? recent.rate - previous.rate : null,
      wrongAppearances: points.filter((point) => point.correct < point.total).length,
      status: classifyStatus(cumulative, points.length),
      recentStatus: classifyStatus(recent, recentPoints.length),
    }
    return { ...type, reason: describePriority(type) }
  }).sort(compareCumulativeResults)
  const wrongCount = reading.filter((answer) => !answer.is_correct).length
  const candidates = types.filter((type) => type.wrong > 0)
  // Cumulative classification stays visible, while recovered types do not
  // displace current review needs and a recent concern can surface despite a high period average.
  const needsReview = candidates.filter((type) => ((type.status === 'priority' || type.status === 'review') && type.recentStatus !== 'stable')
    || (type.status === 'stable' && type.recentStatus === 'priority')).sort(compareRecommendations)
  const needsEvidence = candidates.filter((type) => type.status === 'insufficient')
  const priorities = (needsReview.length > 0 ? needsReview : needsEvidence.length > 0 ? needsEvidence : candidates).slice(0, 3)
  const focus = priorities[0] ?? null
  const headline = focus
    ? `${focus.name},\n${focus.status === 'insufficient' ? '약점 판단은 보류해요.'
      : (focus.status === 'priority' || focus.status === 'review') && focus.recentStatus === 'stable' ? '최근에는 안정적이에요.'
        : focus.status === 'stable' && focus.recentStatus === 'priority' ? '최근 결과를 확인해요.'
          : focus.recent.wrong === 0 ? '이전 오답을 함께 확인해요.'
        : focus.status === 'stable' ? '남은 오답만 확인해요.'
        : hasMeaningfulDecline(focus) ? '최근 정답률이 낮아졌어요.'
          : focus.wrongAppearances >= 2 ? '이 기간 오답이 반복됐어요.' : '먼저 함께 짚어볼까요?'}`
    : wrongCount > 0 ? '틀린 문제를\n함께 짚어볼까요?'
      : reading.length > 0 ? '확인된 문제를\n모두 맞혔어요.' : '학습 기록이 쌓이면\n함께 살펴봐요.'
  const description = focus
    ? focus.reason
    : wrongCount > 0 ? '문제별 해설에서 놓친 근거를 확인해 보세요.'
      : reading.length > 0 ? '이 기간에 확인된 문항별 결과예요.'
        : '문항별 결과가 등록되면 유형과 변화를 보여드릴게요.'
  const concentrationTypes = priorities.slice(0, 2)
  const concentrationIds = new Set(concentrationTypes.map((type) => type.id))
  const concentratedAnswers = new Set(reading.filter((answer) => !answer.is_correct
    && answer.exam_question!.exam_question_tag.some(({ concept_tag: tag }) => tag && concentrationIds.has(tag.id)))
    .map((answer) => answer.id))
  const concentration: AnalysisConcentration | null = concentrationTypes.length > 0 && wrongCount > 0
    ? {
      typeIds: concentrationTypes.map((type) => type.id),
      names: concentrationTypes.map((type) => type.name),
      wrong: concentratedAnswers.size,
      totalWrong: wrongCount,
      share: Math.round(concentratedAnswers.size / wrongCount * 100),
    } : null
  const improvement = types.filter((type) => type.trendComparable && type.previous
    && (type.recent.correct * type.previous.total - type.previous.correct * type.recent.total) * 100
      >= 15 * type.recent.total * type.previous.total)
    .sort((a, b) => b.change! - a.change! || b.recent.total - a.recent.total || a.name.localeCompare(b.name, 'ko-KR'))[0] ?? null
  const strength = types.filter((type) => type.status === 'stable' && type.recentStatus === 'stable'
    && type.points.slice(-ANALYSIS_RECENT_APPEARANCES).every((point) => point.correct * 100 >= point.total * 80))
    // Prefer the strongest worst appearance, then cumulative accuracy and evidence size.
    .sort((a, b) => Math.min(...b.points.slice(-ANALYSIS_RECENT_APPEARANCES).map((point) => point.correct / point.total)) - Math.min(...a.points.slice(-ANALYSIS_RECENT_APPEARANCES).map((point) => point.correct / point.total))
      || (b.total - b.wrong) / b.total - (a.total - a.wrong) / a.total
      || b.total - a.total
      || a.name.localeCompare(b.name, 'ko-KR'))[0] ?? null
  return {
    types, priorities, focus, headline, description, wrongCount, untaggedCount,
    concentration, improvement, strength,
    statusCounts: {
      priority: types.filter((type) => type.status === 'priority').length,
      review: types.filter((type) => type.status === 'review').length,
      stable: types.filter((type) => type.status === 'stable').length,
      insufficient: types.filter((type) => type.status === 'insufficient').length,
    },
    readingCount: reading.length,
    weekCount: new Set(reading.map((answer) => answer.exam_question!.week_id)).size,
    // Compare actual appearances, not consecutive calendar weeks. Never invent a zero for a missing exam.
    trends: types.filter((type) => type.points.length >= 2),
  }
}
