import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '@/lib/concurrency'

// 문제지 PDF 청크 병렬 파싱(week-reading-import)의 핵심 — 순서 보존 + 동시 수 제한 + 실패 전파

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('mapWithConcurrency', () => {
  it('빈 배열이면 빈 배열', async () => {
    expect(await mapWithConcurrency([], 2, async (x) => x)).toEqual([])
  })

  it('결과는 입력 순서대로 (완료 순서와 무관)', async () => {
    const delays = [30, 5, 20, 1]
    const result = await mapWithConcurrency(delays, 2, async (ms, index) => {
      await new Promise((r) => setTimeout(r, ms))
      return `${index}:${ms}`
    })
    expect(result).toEqual(['0:30', '1:5', '2:20', '3:1'])
  })

  it('동시에 concurrency 개까지만 실행한다', async () => {
    let running = 0
    let peak = 0
    const gates = Array.from({ length: 5 }, () => deferred<void>())

    const promise = mapWithConcurrency(gates, 2, async (gate) => {
      running += 1
      peak = Math.max(peak, running)
      await gate.promise
      running -= 1
    })

    // 처음 두 개만 시작돼야 한다
    await Promise.resolve()
    expect(running).toBe(2)

    gates[0].resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(running).toBe(2) // 하나 끝나면 다음 하나가 바로 들어옴

    gates.slice(1).forEach((g) => g.resolve())
    await promise
    expect(peak).toBe(2)
  })

  it('concurrency 가 항목 수보다 커도 문제 없다', async () => {
    const result = await mapWithConcurrency([1, 2], 10, async (x) => x * 2)
    expect(result).toEqual([2, 4])
  })

  it('concurrency 0 / 소수는 1로 취급한다', async () => {
    const order: number[] = []
    await mapWithConcurrency([1, 2, 3], 0, async (x) => { order.push(x) })
    expect(order).toEqual([1, 2, 3])
    await mapWithConcurrency([1], 0.5, async (x) => x)
  })

  it('하나라도 실패하면 reject 한다 (문제지 청크 파싱 실패 → 업로드 전체 실패)', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('chunk failed')
        return x
      }),
    ).rejects.toThrow('chunk failed')
  })

  it('mapper 에 index 가 넘어온다', async () => {
    const result = await mapWithConcurrency(['a', 'b', 'c'], 3, async (item, index) => `${index}${item}`)
    expect(result).toEqual(['0a', '1b', '2c'])
  })
})
