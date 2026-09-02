// 홈 탭 "이번 주" 헤드라인 문장 규칙.
//
// 학부모가 첫 줄로 읽는 문장이라, 어떤 사실을 먼저 말하는지(우선순위)가 곧 UX 다.
// 순서: 지난주 대비 큰 변화 > 만점 > 반 평균 대비 > 담담한 점수 나열.

import { describe, expect, it } from 'vitest'
import { buildWeeklyHeadline, buildWeeklyNotes, fmtCount, fmtDelta, isComparableTotal, type WeeklyMetric } from '@/app/share/[token]/share-utils'

function metric(over: Partial<WeeklyMetric> = {}): WeeklyMetric {
  return { rate: 60, correct: 12, total: 20, delta: null, classDiff: null, ...over }
}

describe('buildWeeklyHeadline', () => {
  it('시험도 단어도 없으면 과제만, 그것도 없으면 기록 없음', () => {
    expect(buildWeeklyHeadline({ reading: null, vocab: null, homework: null })).toBe('이번 주 기록이 아직 없어요.')
    expect(buildWeeklyHeadline({ reading: null, vocab: null, homework: metric({ correct: 3, total: 4 }) }))
      .toBe('이번 주는 과제 4개 중 3개를 제출했어요.')
  })

  it('지난주 대비 5%p 이상 움직였으면 그걸 먼저 말한다 — 더 크게 움직인 쪽', () => {
    const r = { reading: metric({ delta: 6 }), vocab: metric({ delta: -15 }), homework: null }
    expect(buildWeeklyHeadline(r)).toBe('단어 정답률이 지난주보다 15%p 낮아졌어요.')
    expect(buildWeeklyHeadline({ ...r, vocab: metric({ delta: -2 }) })).toBe('시험 정답률이 지난주보다 6%p 올랐어요.')
  })

  it('작은 변화는 무시하고 만점을 말한다', () => {
    const r = { reading: metric({ delta: 3 }), vocab: metric({ correct: 20, total: 20, rate: 100, delta: 0 }), homework: null }
    expect(buildWeeklyHeadline(r)).toBe('단어 20문항을 모두 맞혔어요.')
  })

  it('만점도 큰 변화도 없으면 반 평균 대비를 말한다', () => {
    const r = { reading: metric({ classDiff: 7 }), vocab: metric({ classDiff: 1 }), homework: null }
    expect(buildWeeklyHeadline(r)).toBe('시험은 반 평균보다 7%p 높았어요.')
  })

  it('아무 특징이 없으면 점수만 담담하게 — 지난주가 있으면 "비슷했어요"', () => {
    const withPrev = { reading: metric({ delta: 1 }), vocab: metric({ correct: 18, total: 20, delta: -2 }), homework: null }
    expect(buildWeeklyHeadline(withPrev)).toBe('시험 12/20, 단어 18/20로 지난주와 비슷했어요.')
    const first = { reading: metric(), vocab: null, homework: null }
    expect(buildWeeklyHeadline(first)).toBe('시험 12/20를 맞혔어요.')
  })
})

describe('fmtDelta', () => {
  it('양수에만 + 를 붙인다', () => {
    expect(fmtDelta(8)).toBe('+8%p')
    expect(fmtDelta(-3)).toBe('-3%p')
    expect(fmtDelta(0)).toBe('0%p')
  })
})

describe('isComparableTotal', () => {
  it('문항 수가 절반 이하로 다르면 비교하지 않는다 — 시험 종류가 바뀐 것', () => {
    expect(isComparableTotal(10, 17)).toBe(true)
    expect(isComparableTotal(10, 21)).toBe(false)
    expect(isComparableTotal(0, 10)).toBe(false)
  })
})

describe('buildWeeklyNotes', () => {
  const base = { reading: null, vocab: null, homework: null, wrongReading: 0, wrongVocab: 0, retakePending: 0, retakeTaken: false, attendanceStreak: 0 }

  it('만점·연속 출석은 잘한 점, 오답·미제출은 챙길 점', () => {
    const r = buildWeeklyNotes({
      ...base,
      reading: metric({ correct: 17, total: 17, rate: 100 }),
      vocab: metric({ correct: 34, total: 50, rate: 68 }),
      homework: metric({ correct: 2.5, total: 5, rate: 50 }),
      wrongVocab: 16, attendanceStreak: 5,
    })
    expect(r.good).toEqual(['시험 만점', '5회 연속 출석'])
    expect(r.watch).toEqual(['단어 16개 오답', '과제 2.5개 미제출'])
  })

  it('각 최대 2줄 — 하락이 오답보다 먼저', () => {
    const r = buildWeeklyNotes({
      ...base,
      vocab: metric({ correct: 30, total: 50, rate: 60, delta: -20, classDiff: -15 }),
      wrongVocab: 20, wrongReading: 3,
    })
    expect(r.watch).toEqual(['단어 지난주보다 -20%p', '단어 20개 오답'])
    expect(r.good).toEqual([])
  })

  it('재시험을 본 경우에만 남은 개수를 덧붙인다', () => {
    expect(buildWeeklyNotes({ ...base, wrongVocab: 7, retakePending: 2, retakeTaken: true }).watch).toEqual(['단어 7개 오답 · 재시험 2개 남음'])
    expect(buildWeeklyNotes({ ...base, wrongVocab: 7, retakePending: 7, retakeTaken: false }).watch).toEqual(['단어 7개 오답'])
  })
})

describe('fmtCount', () => {
  it('정수는 그대로, 소수는 한 자리', () => {
    expect(fmtCount(5)).toBe('5')
    expect(fmtCount(2.5)).toBe('2.5')
  })
})
