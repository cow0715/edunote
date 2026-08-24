'use client'

import { useSyncExternalStore } from 'react'

const TICK_MS = 10_000

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, TICK_MS)
  return () => clearInterval(id)
}

// TICK_MS 단위로 굳힌 값 — 같은 구간에서는 같은 숫자라 useSyncExternalStore 가 불필요한 리렌더를 하지 않는다
function getSnapshot() {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS
}

// SSR 에는 시계가 없다. 0 이면 "아직 아무 시각도 지나지 않음" 으로 취급돼 예약 경고가 뜨지 않는다
function getServerSnapshot() {
  return 0
}

/**
 * 흐르는 시계를 외부 시스템으로 구독한다.
 *
 * 렌더 중 `Date.now()` 를 부르면 그 값이 그대로 굳어서 "예약 시간이 지났나" 같은 판정이 갱신되지
 * 않는다(그리고 react-hooks/purity 린트가 막는다). 대신 이 훅이 최대 {@link TICK_MS} 마다 값을 바꾼다.
 *
 * 그만큼 뒤처질 수 있으므로 **확정 판정은 핸들러에서 `Date.now()` 로 다시** 해야 한다.
 */
export function useNowTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
