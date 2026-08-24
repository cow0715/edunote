/** 문자 예약 발송 시각 계산. 기준 시각(now)을 인자로 받아 순수 함수로 유지한다. */

/** `2026-08-24` + `19:30` → KST 기준 epoch ms. 값이 비었거나 파싱 불가면 null. */
export function scheduledAtMs(date: string, time: string): number | null {
  if (!date || !time) return null
  const ms = new Date(`${date}T${time}:00+09:00`).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * 예약 시각이 기준 시각(now) 이하인가 = 이미 지났나.
 *
 * now 를 밖에서 받는 이유: 렌더 중에는 `Date.now()` 를 부를 수 없다(값이 굳어 판정이 갱신되지 않고
 * react-hooks/purity 린트가 막는다). 화면 표시는 `useNowTick()` 값을, **확정 판정은 핸들러에서
 * `Date.now()`** 를 넘겨서 쓴다.
 */
export function isSchedulePast(date: string, time: string, now: number): boolean {
  const ms = scheduledAtMs(date, time)
  return ms !== null && ms <= now
}
