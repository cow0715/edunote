/**
 * 차트/상태 색상 팔레트
 *
 * 다크모드: 같은 Hue(색상), 낮은 Chroma(채도) + 높은 Lightness
 * → 형광처럼 떠보이지 않고 배경과 조화로움
 */

/**
 * 정답률 상태 색.
 *
 * share 리포트 리디자인(design_handoff_share_report) 이후 카테고리·등급을 색으로
 * 나누지 않는다: 60% 미만만 주의(빨강), 그 외는 잉크. 다크 대응은 별도 작업이라
 * isDark 인자는 받지 않는다.
 */
export const statusColor = (rate: number) => (rate < 60 ? '#F04452' : '#191F28')

/** 오답률용 (높을수록 나쁨) */
export const wrongColor = (index: number, isDark?: boolean) => {
  if (isDark) return index < 3 ? '#fca5a5' : '#fde68a'
  return index < 3 ? '#f87171' : '#fbbf24'
}

/** 과제 완료율 */
export const homeworkColor = (rate: number, isDark?: boolean) => {
  if (isDark) {
    if (rate >= 80) return '#fde68a'  // amber-200
    if (rate >= 50) return '#fef3c7'  // amber-100
    return '#fef9c3'                  // yellow-100
  }
  if (rate >= 80) return '#f59e0b'
  if (rate >= 50) return '#fcd34d'
  return '#fde68a'
}
