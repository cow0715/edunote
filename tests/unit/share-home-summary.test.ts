// 홈 "이번 주 카드" 의 문장 규칙.
//
// 학부모가 첫 줄로 읽는 문장이라, 어떤 사실을 먼저 말하는지(우선순위)가 곧 UX 다.
// 순서(design_handoff_share_report/README.md "① 이번 주 카드"):
//   시험 만점 > 시험 없이 단어만 > 이 기간 첫 회차 > 두 지표가 움직인 방향.

import { describe, expect, it } from 'vitest'
import {
  buildWeeklyFacts,
  buildWeeklyHeadline,
  fmtCount,
  fmtDelta,
  isComparableTotal,
  type WeeklyMetric,
} from '@/app/share/[token]/share-utils'

function metric(over: Partial<WeeklyMetric> = {}): WeeklyMetric {
  return { rate: 60, correct: 12, total: 20, delta: null, classDiff: null, ...over }
}

describe('buildWeeklyHeadline', () => {
  it('시험 만점이면 다른 변화보다 먼저 말한다', () => {
    const r = {
      reading: metric({ correct: 17, total: 17, rate: 100, delta: -3 }),
      vocab: metric({ delta: 12 }),
      homework: null,
    }
    expect(buildWeeklyHeadline(r)).toBe('시험 17문항을 모두 맞혔어요.')
  })

  it('시험이 없는 주는 단어만 읽어준다', () => {
    const only = (over: Partial<WeeklyMetric>) =>
      buildWeeklyHeadline({ reading: null, vocab: metric({ correct: 43, total: 50, rate: 86, ...over }), homework: null })

    expect(only({})).toBe('단어 43/50로 시작했어요.')
    expect(only({ delta: 4 })).toBe('단어 43/50, 지난주와 비슷했어요.')
    expect(only({ delta: 11 })).toBe('단어가 11%p 올랐어요.')
    expect(only({ delta: -9 })).toBe('단어가 9%p 내려갔어요.')
  })

  it('시험도 단어도 없으면 과제만, 그것도 없으면 기록 없음', () => {
    expect(buildWeeklyHeadline({ reading: null, vocab: null, homework: null })).toBe('이번 주 기록이 아직 없어요.')
    expect(buildWeeklyHeadline({ reading: null, vocab: null, homework: metric({ correct: 3, total: 4 }) }))
      .toBe('이번 주는 과제 4개 중 3개를 제출했어요.')
  })

  it('지난주가 아예 없으면 이 기간 첫 시험으로 읽는다', () => {
    expect(buildWeeklyHeadline({ reading: metric({ rate: 75 }), vocab: metric({ rate: 88 }), homework: null }))
      .toBe('이 기간 첫 시험. 시험 75%, 단어 88%예요.')
    expect(buildWeeklyHeadline({ reading: metric({ rate: 75 }), vocab: null, homework: null }))
      .toBe('이 기간 첫 시험. 시험 75%예요.')
  })

  it('시험↓ 단어↑ — 단어가 2주 이상 연속 올랐으면 연속 주 수로 말한다', () => {
    const r = { reading: metric({ delta: -25 }), vocab: metric({ delta: 3 }), homework: null }
    expect(buildWeeklyHeadline(r)).toBe('단어는 3%p 올랐고, 시험은 25%p 내려갔어요.')
    expect(buildWeeklyHeadline({ ...r, vocabRisingStreak: 3 }))
      .toBe('단어는 3주 연속 올랐고, 시험은 25%p 내려갔어요.')
  })

  it('나머지 방향 조합', () => {
    const h = (rd: number, vd: number) =>
      buildWeeklyHeadline({ reading: metric({ delta: rd }), vocab: metric({ delta: vd }), homework: null })
    expect(h(8, -4)).toBe('시험은 8%p 올랐지만, 단어를 놓쳤어요.')
    expect(h(8, 4)).toBe('시험·단어 둘 다 올랐어요.')
    expect(h(-8, -4)).toBe('시험·단어 둘 다 내려간 주예요.')
  })

  it('한쪽만 움직였거나 제자리면 점수만 담담하게', () => {
    expect(buildWeeklyHeadline({
      reading: metric({ delta: 0 }),
      vocab: metric({ correct: 18, total: 20, delta: -2 }),
      homework: null,
    })).toBe('시험 12/20, 단어 18/20로 지난주와 비슷했어요.')
  })
})

describe('buildWeeklyFacts', () => {
  const base = { reading: null, vocab: null, homework: null, wrongVocab: 0, wrongVocabDerived: 0 }

  it('점수 줄은 "몇/몇 (몇%) · 지난주 대비 · 반 평균 대비" 순서', () => {
    const r = buildWeeklyFacts({
      ...base,
      reading: metric({ correct: 2, total: 4, rate: 50, delta: -25, classDiff: -12 }),
      vocab: metric({ correct: 40, total: 52, rate: 77, delta: 3, classDiff: 6 }),
    })
    expect(r[0]).toEqual({ text: '시험 2/4 (50%) · -25%p · 반 평균 -12', warn: true })
    expect(r[1]).toEqual({ text: '단어 40/52 (77%) · +3%p · 반 평균 +6', warn: false })
  })

  it('정답률 60% 미만·하락·반 평균 미만이면 주의로 표시한다', () => {
    const warnOf = (over: Partial<WeeklyMetric>) =>
      buildWeeklyFacts({ ...base, vocab: metric({ rate: 80, ...over }) })[0].warn
    expect(warnOf({})).toBe(false)
    expect(warnOf({ rate: 59 })).toBe(true)
    expect(warnOf({ delta: -1 })).toBe(true)
    expect(warnOf({ classDiff: -1 })).toBe(true)
  })

  it('과제는 미제출이 있을 때만 주의', () => {
    expect(buildWeeklyFacts({ ...base, homework: metric({ correct: 4, total: 5 }) })[0])
      .toEqual({ text: '과제 4/5 · 1개 미제출', warn: true })
    expect(buildWeeklyFacts({ ...base, homework: metric({ correct: 5, total: 5 }) })[0])
      .toEqual({ text: '과제 5/5 · 전부 제출', warn: false })
  })

  it('단어 오답 줄은 유의·반의어 출제 수가 있을 때만 덧붙인다', () => {
    expect(buildWeeklyFacts({ ...base, wrongVocab: 7, wrongVocabDerived: 3 })[0].text)
      .toBe('단어 7개 오답 · 유의·반의어 출제가 3개')
    expect(buildWeeklyFacts({ ...base, wrongVocab: 7 })[0].text).toBe('단어 7개 오답')
    expect(buildWeeklyFacts(base)).toEqual([])
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

describe('fmtCount', () => {
  it('정수는 그대로, 소수는 한 자리', () => {
    expect(fmtCount(5)).toBe('5')
    expect(fmtCount(2.5)).toBe('2.5')
  })
})
