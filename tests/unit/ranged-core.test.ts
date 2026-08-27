import { describe, expect, it } from 'vitest'
import { filterByScope, sliceNumbers } from '@/lib/llm/ranged'

// 출력 범위 분할 코어의 순수 부분: 번호 슬라이스(병렬 폭 결정)와 스코프 밖 응답 안전망.

describe('sliceNumbers', () => {
  it('콜당 목표 개수로 연속 슬라이스한다', () => {
    expect(sliceNumbers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 6))
      .toEqual([[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]])
  })

  it('perCall 은 상한 — 넘치면 그룹 수를 늘리고 크기 편차는 1 이내 (14개/6 → 5+5+4)', () => {
    const groups = sliceNumbers(Array.from({ length: 14 }, (_, i) => i + 1), 6)
    expect(groups.map((g) => g.length)).toEqual([5, 5, 4])
  })

  it('불연속 번호도 목록 순서 그대로 슬라이스한다 (7개/3 → 3+2+2)', () => {
    expect(sliceNumbers([1, 2, 3, 5, 7, 8, 11], 3)).toEqual([[1, 2, 3], [5, 7], [8, 11]])
  })

  it('목표 이하면 그룹 1개, 빈 목록이면 빈 배열', () => {
    expect(sliceNumbers([1, 2, 3], 6)).toEqual([[1, 2, 3]])
    expect(sliceNumbers([], 6)).toEqual([])
  })
})

describe('filterByScope', () => {
  const items = [
    { question_number: 17 }, { question_number: 18 }, { question_number: '19' },
    { question_number: 20 }, { question_number: null },
  ]

  it('range 스코프: 구간 밖·번호 없는 항목을 버린다 (모델이 범위 지시를 어긴 경우 안전망)', () => {
    expect(filterByScope(items, { range: [18, 19] }).map((i) => i.question_number)).toEqual([18, '19'])
  })

  it('numbers 스코프: 명시 목록에 없는 번호를 버린다 (불연속 번호 지원)', () => {
    expect(filterByScope(items, { numbers: [17, 20] }).map((i) => i.question_number)).toEqual([17, 20])
  })
})
