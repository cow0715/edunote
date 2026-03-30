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

export type PatternType = 'persistent' | 'deteriorating' | 'improving'

export type PatternItem = {
  id: string
  name: string
  patternType: PatternType
  overallAccuracy: number   // 전체 정답률 (0~100)
  firstAccuracy: number
  latestAccuracy: number
  diff: number              // latestAccuracy - firstAccuracy
  recentDiff: number        // latestAccuracy - prevAccuracy
  stdDev: number
  weekCount: number         // 출제된 주차 수
  wrongWeekCount: number    // 오답률 50%↑ 인 주차 수
  weeks: { weekNumber: number; accuracy: number; correct: number; total: number }[]
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
    if (weekCount < 2) continue  // 출제 2회 미만 제외

    const totalCorrect = weeks.reduce((s, w) => s + w.correct, 0)
    const totalTotal   = weeks.reduce((s, w) => s + w.total,   0)
    const overallAccuracy = totalTotal > 0 ? Math.round((totalCorrect / totalTotal) * 100) : 0

    if (overallAccuracy >= 70) continue  // 전반적으로 잘 맞히면 약점 아님

    const firstAccuracy  = weeks[0].accuracy
    const latestAccuracy = weeks[weekCount - 1].accuracy
    const prevAccuracy   = weekCount > 1 ? weeks[weekCount - 2].accuracy : latestAccuracy
    const diff           = latestAccuracy - firstAccuracy
    const recentDiff     = latestAccuracy - prevAccuracy
    const wrongWeekCount = weeks.filter((w) => w.accuracy < 50).length

    // 분산: 출제된 주차들만 기준
    const variance = weeks.reduce((s, w) => s + Math.pow(w.accuracy - overallAccuracy, 2), 0) / weekCount
    const stdDev   = Math.sqrt(variance)

    // ── 분류 (우선순위 순) ──────────────────────────────────────────────────
    let patternType: PatternType

    if (wrongWeekCount >= Math.ceil(weekCount * 0.75) && stdDev < 25) {
      // 출제 주차의 75% 이상에서 오답률 50%↑, 일관성 있음 → 고착형
      patternType = 'persistent'
    } else if (diff <= -15 && latestAccuracy < 60 && recentDiff <= 0) {
      // 처음보다 15%p↑ 악화 + 최근 정답률 60% 미만 + 최근 추세도 하락 → 악화형
      patternType = 'deteriorating'
    } else if (diff >= 15 && latestAccuracy < 70) {
      // 처음보다 15%p↑ 개선됐으나 아직 70% 미만 → 개선형
      patternType = 'improving'
    } else {
      // 그 외 (방향성 불명확) → 표시 안 함
      continue
    }

    result.push({
      id, name, patternType,
      overallAccuracy, firstAccuracy, latestAccuracy,
      diff, recentDiff, stdDev, weekCount, wrongWeekCount, weeks,
    })
  }

  // 정렬: 고착형 > 악화형 > 간헐형 > 개선형, 같은 유형 내에서는 정답률 낮은 순
  const ORDER: Record<PatternType, number> = { persistent: 0, deteriorating: 1, improving: 2 }
  return result.sort((a, b) =>
    ORDER[a.patternType] !== ORDER[b.patternType]
      ? ORDER[a.patternType] - ORDER[b.patternType]
      : a.overallAccuracy - b.overallAccuracy
  )
}
