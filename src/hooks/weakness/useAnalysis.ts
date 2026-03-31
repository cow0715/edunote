import { TagSummary } from './useWeaknessData'

export type InsightType = '하락 중' | '반등 조짐' | '꾸준히 상승' | '안정 유지' | '데이터 부족'

export function getInsight(summary: TagSummary): InsightType {
  if (summary.weekCount < 2) return '데이터 부족'
  const { diff, recentDiff } = summary
  if (diff < 0 && recentDiff <= 0) return '하락 중'
  if (diff < 0 && recentDiff > 0) return '반등 조짐'
  if (diff > 0 && recentDiff > 0) return '꾸준히 상승'
  return '안정 유지'
}

export type CategorySummary = {
  categoryId: string
  categoryName: string
  totalCorrect: number
  totalCount: number
  overallAccuracy: number
  firstAccuracy: number
  latestAccuracy: number
  prevAccuracy: number
  diff: number
  recentDiff: number
  weekCount: number
  weeks: { weekNumber: number; accuracy: number }[]
  tags: TagSummary[]
}

export function computeCategorySummaries(tagSummaries: TagSummary[]): CategorySummary[] {
  const catMap = new Map<string, {
    categoryId: string
    categoryName: string
    tags: TagSummary[]
    weekAccMap: Map<number, { correct: number; total: number }>
  }>()

  for (const tag of tagSummaries) {
    const prev = catMap.get(tag.categoryId) ?? {
      categoryId: tag.categoryId,
      categoryName: tag.categoryName,
      tags: [] as TagSummary[],
      weekAccMap: new Map<number, { correct: number; total: number }>(),
    }
    prev.tags.push(tag)
    for (const w of tag.weeks) {
      const entry = prev.weekAccMap.get(w.weekNumber) ?? { correct: 0, total: 0 }
      // accuracy를 역산하기 어려우니 tag.weeks에서 직접 correct/total 추적은 못하므로
      // 카테고리 정확도는 단순 평균으로 계산
      entry.correct += 1 // placeholder: 평균 계산을 위해 accumulate accuracy
      entry.total += 1
      prev.weekAccMap.set(w.weekNumber, entry)
    }
    catMap.set(tag.categoryId, prev)
  }

  // CategorySummary 조합 (카테고리별 주차 정확도는 해당 주 출제된 태그들의 평균 정확도)
  const results: CategorySummary[] = []

  for (const [, cat] of catMap.entries()) {
    const totalCorrect = cat.tags.reduce((s, t) => s + t.totalCorrect, 0)
    const totalCount = cat.tags.reduce((s, t) => s + t.totalCount, 0)
    const overallAccuracy = totalCount > 0 ? Math.round((totalCorrect / totalCount) * 100) : 0

    // 주차별 평균 정확도: 해당 주차에 출제된 태그들의 평균
    const weekNumSet = new Set<number>()
    for (const tag of cat.tags) {
      for (const w of tag.weeks) weekNumSet.add(w.weekNumber)
    }
    const sortedWeekNums = [...weekNumSet].sort((a, b) => a - b)

    const weeks = sortedWeekNums.map((wn) => {
      const tagsInWeek = cat.tags.filter((t) => t.weeks.some((w) => w.weekNumber === wn))
      const accuracies = tagsInWeek.flatMap((t) => t.weeks.filter((w) => w.weekNumber === wn).map((w) => w.accuracy))
      const avg = accuracies.length > 0
        ? Math.round(accuracies.reduce((s, a) => s + a, 0) / accuracies.length)
        : 0
      return { weekNumber: wn, accuracy: avg }
    })

    const weekCount = weeks.length
    const firstAccuracy = weekCount > 0 ? weeks[0].accuracy : 0
    const latestAccuracy = weekCount > 0 ? weeks[weekCount - 1].accuracy : 0
    const prevAccuracy = weekCount > 1 ? weeks[weekCount - 2].accuracy : latestAccuracy

    results.push({
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      totalCorrect,
      totalCount,
      overallAccuracy,
      firstAccuracy,
      latestAccuracy,
      prevAccuracy,
      diff: latestAccuracy - firstAccuracy,
      recentDiff: latestAccuracy - prevAccuracy,
      weekCount,
      weeks,
      tags: cat.tags,
    })
  }

  return results.sort((a, b) => a.overallAccuracy - b.overallAccuracy)
}

export function getInsightForCategory(summary: CategorySummary): InsightType {
  if (summary.weekCount < 2) return '데이터 부족'
  const { diff, recentDiff } = summary
  if (diff < 0 && recentDiff <= 0) return '하락 중'
  if (diff < 0 && recentDiff > 0) return '반등 조짐'
  if (diff > 0 && recentDiff > 0) return '꾸준히 상승'
  return '안정 유지'
}

export function detectWeaknessAlerts(tagSummaries: TagSummary[]): TagSummary[] {
  return tagSummaries.filter((t) => t.weekCount >= 3 && t.overallAccuracy < 50)
}

// ── 반복 오답 패턴 분류 ──────────────────────────────────────────────────────

export type PatternType = 'persistent' | 'deteriorating' | 'improving' | 'unstable'

export type PatternItem = {
  id: string
  name: string
  patternType: PatternType
  overallAccuracy: number   // 전체 가중 정답률 (0~100)
  recentAccuracy: number    // 최근 2주 합산 가중 정답률 (0~100)
  trend: number             // 뒤 절반 - 앞 절반 가중 정답률 차이 (-100~100)
  volatility: number        // max(주차%) - min(주차%) (0~100)
  weekCount: number         // 출제된 주차 수
  wrongWeekCount: number    // 정답률 50% 미만인 주차 수
  weeks: { weekNumber: number; accuracy: number; correct: number; total: number }[]
}

// 가중 정답률 계산 헬퍼 (문항 수 기반 가중평균)
function weightedAccuracy(weeks: { correct: number; total: number }[]): number {
  const totalCorrect = weeks.reduce((s, w) => s + w.correct, 0)
  const totalTotal   = weeks.reduce((s, w) => s + w.total,   0)
  return totalTotal > 0 ? (totalCorrect / totalTotal) * 100 : 0
}

export function classifyPatterns(
  rawAnswers: {
    is_correct: boolean
    exam_question?: {
      exam_type: string | null
      week_id: string
      exam_question_tag?: { concept_tag?: { id: string; name: string } | null }[]
    } | null
  }[],
  weekNumberByWeekId: Map<string, number>,
): PatternItem[] {
  // 태그 × 주차 → { correct, total }
  type WeekEntry = { correct: number; total: number }
  const tagMap = new Map<string, { id: string; name: string; byWeek: Map<number, WeekEntry> }>()

  for (const a of rawAnswers) {
    if (a.exam_question?.exam_type !== 'reading') continue
    const weekNum = weekNumberByWeekId.get(a.exam_question.week_id) ?? 0
    for (const t of a.exam_question.exam_question_tag ?? []) {
      const tag = t.concept_tag
      if (!tag) continue
      const entry = tagMap.get(tag.id) ?? { id: tag.id, name: tag.name, byWeek: new Map() }
      const w = entry.byWeek.get(weekNum) ?? { correct: 0, total: 0 }
      w.total += 1
      if (a.is_correct) w.correct += 1
      entry.byWeek.set(weekNum, w)
      tagMap.set(tag.id, entry)
    }
  }

  const result: PatternItem[] = []

  for (const { id, name, byWeek } of tagMap.values()) {
    const weeks = [...byWeek.entries()]
      .sort(([a], [b]) => a - b)
      .map(([weekNumber, { correct, total }]) => ({
        weekNumber,
        correct,
        total,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      }))

    const weekCount = weeks.length
    const totalTotal = weeks.reduce((s, w) => s + w.total, 0)

    // 최소 기준: 2주 이상 + 총 문항 4개 이상
    if (weekCount < 2 || totalTotal < 4) continue

    // 전체 가중 정답률 (0~100 정수)
    const overallAccuracy = Math.round(weightedAccuracy(weeks))
    if (overallAccuracy >= 70) continue  // 약점 범위 아님

    // 앞/뒤 절반 가중 정답률로 trend 계산
    const mid       = Math.ceil(weekCount / 2)
    const frontAcc  = weightedAccuracy(weeks.slice(0, mid))
    const backAcc   = weightedAccuracy(weeks.slice(mid))
    const trend     = Math.round(backAcc - frontAcc)   // -100~100

    // 최근 2주 합산 가중 정답률
    const recentAccuracy = Math.round(weightedAccuracy(weeks.slice(-2)))

    // 주차별 accuracy 범위 (volatility)
    const accuracies  = weeks.map((w) => w.accuracy)
    const volatility  = Math.max(...accuracies) - Math.min(...accuracies)

    // 오답 주차 수 (정답률 50% 미만)
    const wrongWeekCount = weeks.filter((w) => w.accuracy < 50).length
    const wrongWeekRatio = wrongWeekCount / weekCount

    // ── 분류 (우선순위 순) ──────────────────────────────────────────────────
    let patternType: PatternType

    if (wrongWeekRatio >= 0.7 && overallAccuracy < 50) {
      // 출제 주차 70% 이상 오답 + 전체 정답률 50% 미만 → 고착형
      patternType = 'persistent'
    } else if (trend <= -15 && recentAccuracy < 50) {
      // 뒤 절반이 앞 절반보다 15%p↑ 낮음 + 최근 2주 정답률 50% 미만 → 악화형
      patternType = 'deteriorating'
    } else if (trend >= 15 && overallAccuracy < 70) {
      // 뒤 절반이 앞 절반보다 15%p↑ 높음 + 아직 약점 범위 → 개선형
      patternType = 'improving'
    } else if (Math.abs(trend) < 15 && volatility >= 50) {
      // 방향성 없음 + 주차별 정답률 편차 50%p 이상 → 기복형
      patternType = 'unstable'
    } else {
      // 그 외 → 표시 안 함
      continue
    }

    result.push({
      id, name, patternType,
      overallAccuracy, recentAccuracy, trend, volatility,
      weekCount, wrongWeekCount, weeks,
    })
  }

  // 정렬: 고착 > 악화 > 기복 > 개선, 같은 유형 내에서는 정답률 낮은 순
  const ORDER: Record<PatternType, number> = { persistent: 0, deteriorating: 1, unstable: 2, improving: 3 }
  return result.sort((a, b) =>
    ORDER[a.patternType] !== ORDER[b.patternType]
      ? ORDER[a.patternType] - ORDER[b.patternType]
      : a.overallAccuracy - b.overallAccuracy
  )
}
