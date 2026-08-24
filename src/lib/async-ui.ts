/**
 * 비동기 UI 액션용 실행 헬퍼.
 *
 * 왜 컴포넌트 밖 모듈 함수인가:
 * React Compiler 는 `try { } finally { }` 와 `try` 안의 `throw` / `?.` / `??` 를 아직 다루지 못해서,
 * 그런 문법이 **컴포넌트 본문 안에** 있으면 그 컴포넌트 전체를 최적화에서 제외한다(린트에는 안 뜬다).
 * `setLoading(true) … finally setLoading(false)` 는 이 프로젝트에서 가장 흔한 패턴이라
 * try 를 여기 모듈 함수에 몰아넣고 컴포넌트는 콜백만 넘기게 한다.
 */

/**
 * 로딩 플래그를 켜고 fn 을 실행한다. 끝나면(성공/실패 무관) 반드시 끈다.
 * @returns 성공하면 true, fn 이 throw 하면 onError 를 부르고 false
 */
export async function runWithLoading(
  setLoading: (value: boolean) => void,
  fn: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<boolean> {
  setLoading(true)
  try {
    await fn()
    return true
  } catch (error) {
    onError(error)
    return false
  } finally {
    setLoading(false)
  }
}

/**
 * 로딩 플래그 없이 실행하고 실패만 보고한다.
 * @returns 성공하면 true, fn 이 throw 하면 onError 를 부르고 false
 */
export async function runOrReport(
  fn: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (error) {
    onError(error)
    return false
  }
}

/** Error 면 그 메시지를, 아니면 fallback 을 돌려준다 (빈 메시지도 fallback 취급). */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
