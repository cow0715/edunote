/**
 * 차트/상태 색상 팔레트
 *
 * 다크모드: 같은 Hue(색상), 낮은 Chroma(채도) + 높은 Lightness
 * → 형광처럼 떠보이지 않고 배경과 조화로움
 */

export const statusColor = (rate: number, isDark?: boolean) => {
  if (isDark) {
    if (rate >= 80) return '#86efac'  // green-300  — 부드러운 세이지
    if (rate >= 60) return '#fde68a'  // amber-200  — 소프트 골드
    return '#fca5a5'                  // red-300    — 소프트 코랄
  }
  if (rate >= 80) return '#22c55e'    // green-500
  if (rate >= 60) return '#f59e0b'    // amber-500
  return '#f87171'                    // red-400
}

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
