/**
 * 오답률로 약점 유형을 줄 세울 때 쓰는 점수.
 *
 * 그냥 오답률로 정렬하면 표본이 작은 쪽이 전부 위로 온다 —
 * 운영 데이터에서 "학생 × 태그" 조합 1,028개 중 절반이 3문항 이하이고,
 * 그중 178개가 "전부 오답(=100%)" 이다. 이걸 그대로 세우면 1문항짜리가 최상위를 덮는다.
 *
 * 그래서 Wilson 신뢰구간 하한으로 정렬한다. 표본이 작으면 하한이 낮아져 자동으로 밀린다:
 *   1문항 중 1개  (100%) → 0.21
 *   3문항 중 3개  (100%) → 0.44
 *   52문항 중 34개 (65%) → 0.52   ← 표본이 커서 위로
 *   10문항 중 10개 (100%) → 0.72
 *
 * 화면의 막대 길이는 실제 오답률을 쓰고, 이 점수는 순서에만 쓴다.
 */

/** 95% 신뢰구간 (z = 1.96) */
const Z = 1.959963984540054

/**
 * 오답 비율의 Wilson 하한 (0~1). total 이 0 이면 0.
 * @param wrong 오답 수
 * @param total 출제 수
 */
export function wrongRateScore(wrong: number, total: number): number {
  if (total <= 0) return 0
  const n = total
  const p = Math.min(Math.max(wrong / n, 0), 1)
  const z2 = Z * Z
  const denominator = 1 + z2 / n
  const centre = p + z2 / (2 * n)
  const margin = Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
  return Math.max(0, (centre - margin) / denominator)
}

/** 표본이 이 수 이하면 화면에서 "참고용" 으로 눌러 표시한다 */
export const SMALL_SAMPLE_MAX = 2

export type WrongTypeStat = { id: string; name: string; wrong: number; total: number }

/** 약점이 큰 순으로 정렬 — 점수가 같으면 표본이 큰 쪽을 위로 */
export function sortByWeakness<T extends WrongTypeStat>(items: T[]): T[] {
  return items
    .slice()
    .sort((a, b) =>
      wrongRateScore(b.wrong, b.total) - wrongRateScore(a.wrong, a.total) ||
      b.total - a.total ||
      a.name.localeCompare(b.name, 'ko-KR'))
}
