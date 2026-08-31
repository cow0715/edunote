import { describe, expect, it } from 'vitest'
import { sortByWeakness, wrongRateScore, type WrongTypeStat } from '@/lib/wrong-rate'

const stat = (name: string, wrong: number, total: number): WrongTypeStat =>
  ({ id: name, name, wrong, total })

describe('wrongRateScore — 표본이 작으면 점수를 낮춘다', () => {
  it('출제가 없으면 0', () => {
    expect(wrongRateScore(0, 0)).toBe(0)
  })

  it('전부 맞았으면 0', () => {
    expect(wrongRateScore(0, 10)).toBe(0)
  })

  it('같은 100% 여도 표본이 클수록 점수가 높다', () => {
    const one = wrongRateScore(1, 1)
    const three = wrongRateScore(3, 3)
    const ten = wrongRateScore(10, 10)
    expect(one).toBeLessThan(three)
    expect(three).toBeLessThan(ten)
  })

  it('점수는 실제 오답률보다 낮다 (하한이므로)', () => {
    expect(wrongRateScore(1, 1)).toBeLessThan(1)
    expect(wrongRateScore(34, 52)).toBeLessThan(34 / 52)
  })

  it('표본이 큰 65% 가 표본이 작은 100% 를 이긴다', () => {
    // 이 역전이 이 함수를 쓰는 이유다
    expect(wrongRateScore(34, 52)).toBeGreaterThan(wrongRateScore(3, 3))
    expect(wrongRateScore(34, 52)).toBeGreaterThan(wrongRateScore(1, 1))
  })

  it('표본이 아주 크면 실제 오답률에 수렴한다', () => {
    expect(wrongRateScore(650, 1000)).toBeCloseTo(0.65, 1)
  })

  it('0~1 범위를 벗어나지 않는다', () => {
    for (const [w, t] of [[0, 1], [1, 1], [5, 10], [999, 1000]] as const) {
      const s = wrongRateScore(w, t)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })
})

describe('sortByWeakness', () => {
  it('표본이 큰 65% 를 표본이 작은 100% 보다 위에 둔다', () => {
    const sorted = sortByWeakness([
      stat('내용 일치', 3, 3),      // 100%, 표본 3
      stat('빈칸', 34, 52),         // 65%, 표본 52
      stat('요약문', 1, 1),         // 100%, 표본 1
    ])
    expect(sorted.map((s) => s.name)).toEqual(['빈칸', '내용 일치', '요약문'])
  })

  it('10문항 전부 오답은 최상위다', () => {
    const sorted = sortByWeakness([stat('빈칸', 34, 52), stat('어법', 10, 10)])
    expect(sorted[0].name).toBe('어법')
  })

  it('점수가 같으면 표본이 큰 쪽을 위로', () => {
    const sorted = sortByWeakness([stat('적음', 2, 4), stat('많음', 10, 20)])
    expect(sorted[0].name).toBe('많음')
  })

  it('원본 배열을 건드리지 않는다', () => {
    const input = [stat('a', 1, 1), stat('b', 10, 10)]
    sortByWeakness(input)
    expect(input.map((s) => s.name)).toEqual(['a', 'b'])
  })
})
