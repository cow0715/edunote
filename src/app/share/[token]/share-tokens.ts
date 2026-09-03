// TDS(토스 디자인 시스템) 기반 share 리포트 토큰.
// design_handoff_share_report/README.md 의 "디자인 토큰" 표가 원본이다.
//
// 색 사용 원칙: 카테고리(시험/단어/과제)를 색으로 구분하지 않는다.
//   파랑 = 선택/액션/긍정변화/출석, 빨강 = 주의(오답·결석·하락·60% 미만), 나머지는 그레이.
// 이 디자인은 라이트 기준이다 (다크 매핑은 별도 작업).

import type { CSSProperties } from 'react'

export const T = {
  canvas: '#FFFFFF',
  card: '#F9FAFB',
  /** 카드 안 강조 박스 / 입력 / 칩 / 세그먼트 트랙 */
  box: '#F2F4F6',
  /** 카드 안에서 한 겹 더 들어간 박스 */
  boxOnCard: '#FFFFFF',
  line: '#EEF1F4',
  lineStrong: '#E5E8EB',

  ink: '#191F28',
  body: '#333D4B',
  body2: '#4E5968',
  muted: '#6B7684',
  muted2: '#8B95A1',
  disabled: '#B0B8C1',
  disabled2: '#D1D6DB',

  blue: '#3182F6',
  blueDeep: '#1B64DA',
  blueBg: '#E8F3FF',

  red: '#F04452',
  redDeep: '#D22030',
  redBg: '#FFEEEE',

  /** 재시험 집중 모드 전용 다크 패널 */
  panel: '#191F28',
} as const

/** 정답률 60% 미만은 주의(빨강), 그 외는 잉크. 카테고리 색은 쓰지 않는다 */
export const rateColor = (rate: number | null | undefined) =>
  rate !== null && rate !== undefined && rate < 60 ? T.red : T.ink

/** 변화량(%p)·반 평균 차이: 양수 파랑 / 음수 빨강 / 0 회색 */
export const deltaColor = (delta: number | null | undefined) =>
  delta === null || delta === undefined || delta === 0 ? T.muted2 : delta > 0 ? T.blue : T.red

export const ATT_DOT: Record<string, string> = {
  present: T.blue,
  late: T.muted,
  absent: T.red,
}
export const ATT_LABEL_KO: Record<string, string> = { present: '출석', late: '지각', absent: '결석' }

// ── 공통 클래스 ────────────────────────────────────────────────────────────
/** 카드 표면 — 배경색 차이로만 구분한다. 테두리·그림자 없음 */
export const CARD_CLASS = 'rounded-[20px] bg-[#F9FAFB]'
/** 누르는 요소 공통 press 피드백 */
export const PRESS = 'transition-transform duration-[120ms] active:scale-[0.985]'
export const PRESS_STRONG = 'transition-transform duration-[120ms] active:scale-[0.98]'
/** 리스트 행 press — 배경까지 바뀐다 */
export const PRESS_ROW = `${PRESS} active:bg-[#F2F4F6]`

/** 스태거 등장(rise) — 카드 index 로 delay 를 준다 */
export const riseStyle = (index = 0): CSSProperties => ({
  animation: 'share-rise .45s cubic-bezier(.2,.8,.2,1) both',
  animationDelay: `${Math.min(index, 3) * 60}ms`,
})
