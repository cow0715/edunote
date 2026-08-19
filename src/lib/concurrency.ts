/**
 * items 를 최대 concurrency 개씩 동시에 mapper 로 처리하고, 결과는 입력 순서대로 돌려준다.
 * 하나라도 실패하면 즉시 reject (Promise.all 과 같은 의미). 나머지 진행 중인 작업은 취소되지 않는다.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency) || 1), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
