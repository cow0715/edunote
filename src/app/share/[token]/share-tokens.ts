// TDS(토스 디자인 시스템) 기반 share 리포트 토큰.
// design_handoff_share_report/README.md 의 "디자인 토큰" 표가 원본이다.
//
// 색 사용 원칙: 카테고리(시험/단어/과제)를 색으로 구분하지 않는다.
//   파랑 = 선택/액션/긍정변화/출석, 빨강 = 주의(오답·결석·하락·60% 미만), 나머지는 그레이.
// 라이트/다크 값은 src/app/theme-tokens.css에서 공통 관리한다.

import type { CSSProperties } from 'react'

export const T = {
  control: 'var(--control-bg)',
  onControl: 'var(--control-fg)',
  selected: 'var(--control-selected)',
  onSelected: 'var(--control-on-selected)',
  canvas: 'var(--share-canvas)',
  card: 'var(--share-card)',
  /** 카드 안 강조 박스 / 입력 / 칩 / 세그먼트 트랙 */
  box: 'var(--share-box)',
  /** 카드 안에서 한 겹 더 들어간 박스 */
  boxOnCard: 'var(--share-box-on-card)',
  line: 'var(--share-line)',
  lineStrong: 'var(--share-line-strong)',

  ink: 'var(--share-ink)',
  body: 'var(--share-body)',
  body2: 'var(--share-body2)',
  muted: 'var(--share-muted)',
  muted2: 'var(--share-muted2)',
  disabled: 'var(--share-disabled)',
  disabled2: 'var(--share-disabled2)',

  blue: 'var(--share-blue)',
  blueDeep: 'var(--share-blue-deep)',
  blueBg: 'var(--share-blue-bg)',

  red: 'var(--share-red)',
  redDeep: 'var(--share-red-deep)',
  redBg: 'var(--share-red-bg)',

  /** 재시험 집중 모드 전용 다크 패널 */
  panel: 'var(--share-panel)',
  /** Filled actions use a darker blue so white labels stay readable. */
  blueSolid: 'var(--share-blue-solid)',
  onSolid: 'var(--share-on-solid)',
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
export const CARD_CLASS = 'rounded-[20px] bg-[var(--share-card)]'
/** 누르는 요소 공통 press 피드백 */
export const PRESS = 'transition-transform duration-[120ms] active:scale-[0.985]'
export const PRESS_STRONG = 'transition-transform duration-[120ms] active:scale-[0.98]'
/** 리스트 행 press — 배경까지 바뀐다 */
export const PRESS_ROW = `${PRESS} active:bg-[var(--share-box)]`

/** 스태거 등장(rise) — 카드 index 로 delay 를 준다 */
export const riseStyle = (index = 0): CSSProperties => ({
  animation: 'share-rise .45s cubic-bezier(.2,.8,.2,1) both',
  animationDelay: `${Math.min(index, 3) * 60}ms`,
})
