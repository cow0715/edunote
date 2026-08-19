// ── 단어시험 출제 비율 ──────────────────────────────────────────────────────
// 랜덤 출제에서 유형별 문항 수를 배분한다.
// 예문뜻(영→한)·예문빈칸(영→영) 모두 비율 대상이며, 예문이 있는 단어에만 배분된다.

export const RATIO_SOURCES = ['word', 'synonym', 'antonym', 'derivative', 'example_meaning', 'example', 'example_choice'] as const

export type VocabRatioSource = (typeof RATIO_SOURCES)[number]

export type VocabSourceRatio = Record<VocabRatioSource, number>

export const DEFAULT_SOURCE_RATIO: VocabSourceRatio = {
  word: 40, synonym: 20, antonym: 20, derivative: 0, example_meaning: 20, example: 0, example_choice: 0,
}

export const SOURCE_RATIO_PRESETS: Array<{ label: string; ratio: VocabSourceRatio }> = [
  { label: '균형', ratio: DEFAULT_SOURCE_RATIO },
  { label: '원본 위주', ratio: { word: 70, synonym: 10, antonym: 10, derivative: 0, example_meaning: 10, example: 0, example_choice: 0 } },
  { label: '예문 강화', ratio: { word: 40, synonym: 10, antonym: 10, derivative: 0, example_meaning: 20, example: 10, example_choice: 10 } },
  { label: '반의어 강화', ratio: { word: 40, synonym: 10, antonym: 40, derivative: 0, example_meaning: 10, example: 0, example_choice: 0 } },
  { label: '기존 방식', ratio: { word: 50, synonym: 25, antonym: 0, derivative: 25, example_meaning: 0, example: 0, example_choice: 0 } },
]

export function ratioSourceLabel(source: VocabRatioSource): string {
  if (source === 'synonym') return '유의어'
  if (source === 'antonym') return '반의어'
  if (source === 'derivative') return '파생어'
  if (source === 'example_meaning') return '예문뜻'
  if (source === 'example') return '예문빈칸'
  if (source === 'example_choice') return '예문선택'
  return '원본'
}

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** 한 유형의 비율을 바꾸면 나머지 유형이 기존 비중대로 남은 퍼센트를 나눠 갖는다. 합은 항상 100. */
export function rebalanceSourceRatio(
  current: VocabSourceRatio,
  source: VocabRatioSource,
  rawValue: number
): VocabSourceRatio {
  const value = clampPercent(rawValue)
  const others = RATIO_SOURCES.filter((item) => item !== source)
  const remaining = 100 - value
  const otherTotal = others.reduce((sum, item) => sum + current[item], 0)

  const next = { ...current, [source]: value }
  let assigned = 0
  others.forEach((item, index) => {
    if (index === others.length - 1) {
      next[item] = Math.max(0, remaining - assigned)
      return
    }
    const share = otherTotal === 0
      ? remaining / others.length
      : (current[item] / otherTotal) * remaining
    const rounded = Math.max(0, Math.min(remaining - assigned, Math.round(share)))
    next[item] = rounded
    assigned += rounded
  })
  return next
}

/**
 * 후보가 없는 유형(예: 예문 생성 전이라 예문 유형 후보 0)의 비율을 0으로 접고,
 * 그 몫을 후보가 있는 나머지 유형에 기존 비중대로 나눠 준다. 나눠 줄 데가 없으면 원본으로.
 * 화면·랜덤 출제는 이 "실효 비율" 을 쓴다 — 안 그러면 예문 10% 라고 써 놓고 조용히 원본으로 채워진다.
 */
export function applySourceAvailability(
  ratio: VocabSourceRatio,
  candidateCounts: Partial<Record<VocabRatioSource, number>>,
): VocabSourceRatio {
  const available = RATIO_SOURCES.filter((source) => (candidateCounts[source] ?? 0) > 0)
  const unavailable = RATIO_SOURCES.filter((source) => (candidateCounts[source] ?? 0) === 0)
  if (unavailable.length === 0) return ratio
  const lost = unavailable.reduce((sum, source) => sum + ratio[source], 0)
  const next: VocabSourceRatio = { ...ratio }
  unavailable.forEach((source) => { next[source] = 0 })
  if (lost === 0) return next
  const keepTotal = available.reduce((sum, source) => sum + ratio[source], 0)
  if (available.length === 0) return next
  if (keepTotal === 0) {
    // 남은 유형이 전부 0% 였으면 원본(있으면)에 몰아준다
    const target = available.includes('word') ? 'word' : available[0]
    next[target] = 100
    return next
  }
  let assigned = 0
  available.forEach((source, index) => {
    if (index === available.length - 1) {
      next[source] = 100 - assigned
      return
    }
    const value = Math.round((ratio[source] / keepTotal) * 100)
    next[source] = value
    assigned += value
  })
  return next
}

/** 문항 수를 비율대로 배분한다 (내림 후 소수점 큰 순서로 잔여 배분, 합계 = count). */
export function allocatePromptTargets(count: number, ratio: VocabSourceRatio): VocabSourceRatio {
  const rawTargets = RATIO_SOURCES.map((source) => ({
    source,
    raw: count * (ratio[source] / 100),
  }))
  const targets = rawTargets.reduce<VocabSourceRatio>((acc, item) => {
    acc[item.source] = Math.floor(item.raw)
    return acc
  }, { word: 0, synonym: 0, antonym: 0, derivative: 0, example_meaning: 0, example: 0, example_choice: 0 })
  let assigned = RATIO_SOURCES.reduce((sum, source) => sum + targets[source], 0)
  for (const item of rawTargets.sort((a, b) => (b.raw - Math.floor(b.raw)) - (a.raw - Math.floor(a.raw)))) {
    if (assigned >= count) break
    targets[item.source] += 1
    assigned += 1
  }
  return targets
}
