import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_MIN_APPEARANCES, ANALYSIS_MIN_QUESTIONS, ANALYSIS_RECENT_APPEARANCES,
  ANALYSIS_STATUS_LABELS, buildShareAnalysis,
} from '@/lib/share-analysis'
import { analysisAnswer as answer, analysisWeek as week, analysisTag as tag, analysisFixture } from '../fixtures/share-analysis'

type Appearance = { total: number; correct: number }
function period(count: number) {
  return Array.from({ length: count }, (_, i) => week(`w${i + 1}`, i + 1))
}
function appearances(id: string, counts: Appearance[], name = id) {
  const concept = { ...tag, id, name }
  return counts.flatMap((count, i) => Array.from({ length: count.total }, (_, question) =>
    answer(`${id}-${i}-${question}`, `w${i + 1}`, question < count.correct, [concept])))
}
function aggregate(id: string, total: number, correct: number, count = 3, start = 1, name = id) {
  const concept = { ...tag, id, name }
  return Array.from({ length: total }, (_, i) =>
    answer(`${id}-${start}-${i}`, `w${start + i % count}`, i < correct, [concept]))
}
function comparison(previousCorrect: number, previousTotal: number, recentCorrect: number, recentTotal: number) {
  return buildShareAnalysis([
    ...aggregate(tag.id, previousTotal, previousCorrect, 4),
    ...aggregate(tag.id, recentTotal, recentCorrect, 4, 5),
  ], period(8))
}

describe('share 분석의 실제 데이터 해석', () => {
  it('기간 누적과 최근 출제 기록을 따로 제공하며 적은 기록의 약점 판단을 보류한다', () => {
    const result = buildShareAnalysis(analysisFixture.studentAnswers, analysisFixture.weeks)
    expect(result.focus).toMatchObject({ id: 'blank', wrong: 3, total: 5,
      cumulative: { correct: 2, total: 5, wrong: 3, rate: 40 },
      recent: { correct: 2, total: 5, wrong: 3, rate: 40 }, previous: null,
      recentCount: 2, previousCount: 0, trendComparable: false, change: null,
      wrongAppearances: 2, status: 'insufficient', recentStatus: 'insufficient',
    })
    expect(result.headline).toBe('빈칸 추론,\n약점 판단은 보류해요.')
    expect(result.description).toContain('3회 출제·10문항 기준을 충족하지 않아')
    expect(result.description).toContain('5문항 중 3문항')
    expect(result.trends.find((type) => type.id === 'blank')?.points.map((point) => point.rate)).toEqual([0, 67])
    expect(result).toMatchObject({ readingCount: 8, weekCount: 2 })
  })

  it('문항 수가 많아도 한 회차에만 출제됐으면 약점을 확정하지 않는다', () => {
    const result = buildShareAnalysis([
      ...aggregate('large', 20, 10, 1), ...aggregate('rare', 1, 0, 1),
    ], period(1))
    expect(result.types.every((type) => type.status === 'insufficient')).toBe(true)
    expect(result.focus?.id).toBe('large')
    expect(result.headline).toContain('약점 판단은 보류')
    expect(result.strength).toBeNull()
  })

  it('전부 정답, 유형 미분류, 미등록을 서로 구분한다', () => {
    expect(buildShareAnalysis([answer('a', 'w', true)], [week('w')]).headline).toContain('모두 맞혔어요')
    const untagged = buildShareAnalysis([answer('a', 'w', false, [])], [week('w')])
    expect(untagged).toMatchObject({ focus: null, wrongCount: 1, untaggedCount: 1,
      priorities: [], concentration: null, improvement: null, strength: null })
    expect(untagged.headline).toContain('틀린 문제')
    expect(buildShareAnalysis([], [week('w')]).headline).toContain('기록이 쌓이면')
  })

  it('기간 밖 답과 단어 답을 제외하고 중복 태그를 한 번만 센다', () => {
    const vocab = answer('v', 'w', false)
    vocab.exam_question!.exam_type = 'vocab'
    const result = buildShareAnalysis([answer('a', 'w', false, [tag, tag]), answer('b', 'outside', false), vocab], [week('w')])
    expect(result.readingCount).toBe(1)
    expect(result.types[0]).toMatchObject({ total: 1, wrongAppearances: 1,
      cumulative: { correct: 0, total: 1, wrong: 1, rate: 0 }, recentCount: 1 })
    expect(result.concentration).toMatchObject({ wrong: 1, totalWrong: 1, share: 100 })
  })

  it('선택 기간에 충분한 정답 기록이 있어도 기간 밖 오답을 합산하지 않는다', () => {
    const result = buildShareAnalysis([
      ...aggregate(tag.id, 12, 12), ...aggregate(tag.id, 100, 0, 4, 10),
    ], period(3))
    expect(result.types[0]).toMatchObject({ total: 12, wrong: 0, status: 'stable', recentStatus: 'stable' })
    expect(result).toMatchObject({ readingCount: 12, wrongCount: 0, focus: null })
    expect(result.strength?.id).toBe(tag.id)
  })

  it('같은 회차 번호인 다른 수업을 합치지 않고 미출제를 0%로 채우지 않는다', () => {
    const result = buildShareAnalysis([answer('b', 'b', true), answer('a', 'a', false)],
      [week('b', 1, '2026-09-24'), week('missing', 2, '2026-09-20'), week('a', 1, '2026-09-17')])
    expect(result.types[0].points.map((point) => [point.weekId, point.rate])).toEqual([['a', 0], ['b', 100]])
    expect(result.types[0]).toMatchObject({ recent: { correct: 1, total: 2, wrong: 1, rate: 50 },
      previous: null, recentCount: 2, wrongAppearances: 1 })
  })

  it('최근 네 출제 회차와 직전 네 출제 회차를 문항 수로 가중 합산한다', () => {
    const counts = [
      { total: 1, correct: 0 }, { total: 9, correct: 9 }, { total: 1, correct: 0 }, { total: 9, correct: 9 },
      { total: 1, correct: 1 }, { total: 9, correct: 0 }, { total: 1, correct: 1 }, { total: 9, correct: 0 },
    ]
    const result = buildShareAnalysis(appearances(tag.id, counts, tag.name), [...period(8)].reverse())
    expect(result.types[0]).toMatchObject({
      cumulative: { correct: 20, total: 40, wrong: 20, rate: 50 },
      previous: { correct: 18, total: 20, wrong: 2, rate: 90 },
      recent: { correct: 2, total: 20, wrong: 18, rate: 10 },
      recentCount: 4, previousCount: 4, trendComparable: true, change: -80, status: 'priority',
    })
    expect(result.types[0].points.map((point) => point.weekId)).toEqual(period(8).map((item) => item.id))
    expect(result.headline).toContain('최근 정답률이 낮아졌어요')
    expect(result.description).toContain('직전 20문항의 정답률 90%에서 최근 10%로 80%p 낮아졌어요')
  })

  it('네 회차 안에서는 두 회차만 잘라 판단하지 않고 이전 비교 묶음을 만들지 않는다', () => {
    const result = buildShareAnalysis(appearances(tag.id, [
      { total: 5, correct: 5 }, { total: 5, correct: 5 }, { total: 5, correct: 0 }, { total: 5, correct: 0 },
    ]), period(4))
    expect(result.types[0]).toMatchObject({ cumulative: { rate: 50 }, recent: { rate: 50, total: 20 },
      previous: null, previousCount: 0, change: null, trendComparable: false, status: 'priority' })
    expect(result.description).not.toContain('낮아졌어요')
  })

  it('누적은 모든 출제 회차를 포함하지만 최근 비교는 마지막 여덟 회차만 쓴다', () => {
    const result = buildShareAnalysis(appearances(tag.id,
      Array.from({ length: 9 }, (_, i) => ({ total: 5, correct: i === 0 ? 0 : i < 5 ? 3 : 4 }))), period(9))
    expect(result.types[0]).toMatchObject({ cumulative: { total: 45, correct: 28, rate: 62 },
      previous: { total: 20, correct: 12, rate: 60 }, recent: { total: 20, correct: 16, rate: 80 },
      recentCount: 4, previousCount: 4, change: 20 })
    expect(result.types[0].points).toHaveLength(9)
  })

  it('최근 두 회차가 낮아져도 기간 분류를 최근 결과로 바꾸지 않는다', () => {
    const result = buildShareAnalysis(appearances(tag.id,
      [5, 5, 5, 5, 5, 5, 3, 3].map((correct) => ({ total: 5, correct }))), period(8))
    expect(result.types[0]).toMatchObject({ status: 'stable', cumulative: { rate: 90 },
      recent: { rate: 80 }, recentStatus: 'stable', change: -20 })
    expect(result.headline).toContain('남은 오답만 확인해요')
  })

  it('누적 약점이 최근 회복했으면 현재 보완할 유형을 먼저 추천한다', () => {
    const recovered = appearances('old', [
      ...Array.from({ length: 4 }, () => ({ total: 10, correct: 0 })),
      ...Array.from({ length: 4 }, () => ({ total: 5, correct: 4 })),
    ], '과거 약점')
    const result = buildShareAnalysis([...recovered, ...aggregate('active', 12, 7)], period(8))
    expect(result.types[0]).toMatchObject({ id: 'old', status: 'priority', recentStatus: 'stable' })
    expect(result.priorities.map((type) => type.id)).toEqual(['active'])
    expect(result.improvement).toMatchObject({ id: 'old', change: 80 })
    expect(result.types[0].reason).toContain('최근 4회 출제에서는')
    expect(result.types[0].reason).toContain('안정적이에요. 이전 오답')
    expect(result.types[0].reason).not.toContain('오답이 확인돼 복습을 권해요')
  })

  it('회복한 과거 약점만 남으면 현재 약점으로 고착시키지 않고 이전 오답을 안내한다', () => {
    const result = comparison(0, 20, 20, 20)
    expect(result.focus).toMatchObject({ status: 'priority', recentStatus: 'stable', wrong: 20,
      recent: { total: 20, wrong: 0, rate: 100 } })
    expect(result.headline).toContain('최근에는 안정적이에요')
    expect(result.description).toContain('이전 오답을 확인해요')
    expect(result.description).not.toContain('오답이 확인돼 복습을 권해요')
  })

  it('최근 기록이 적으면 모두 맞혔어도 안정적·개선으로 확정하지 않는다', () => {
    const result = comparison(0, 20, 8, 8)
    expect(result.types[0]).toMatchObject({ status: 'priority', recentStatus: 'insufficient',
      previous: { total: 20, rate: 0 }, recent: { total: 8, rate: 100 },
      recentCount: 4, previousCount: 4, trendComparable: false, change: null })
    expect(result.headline).toContain('이전 오답을 함께 확인해요')
    expect(result.improvement).toBeNull()
    expect(result.strength).toBeNull()
  })

  it('직전 묶음의 문항 수가 적으면 큰 상승·하락 수치를 보류하고 원래 기록은 보존한다', () => {
    const result = comparison(8, 8, 0, 20)
    expect(result.types[0]).toMatchObject({ previous: { total: 8, rate: 100 }, recent: { total: 20, rate: 0 },
      previousCount: 4, recentCount: 4, trendComparable: false, change: null })
    expect(result.headline).not.toContain('낮아졌어요')
    expect(result.description).not.toContain('낮아졌어요')
    expect(result.improvement).toBeNull()
  })

  it('직전 두 회차에 문항이 많아도 비교 최소 출제 횟수를 충족하지 못하면 변화를 보류한다', () => {
    const result = buildShareAnalysis(appearances(tag.id, [
      { total: 10, correct: 0 }, { total: 10, correct: 0 },
      ...Array.from({ length: 4 }, () => ({ total: 5, correct: 5 })),
    ]), period(6))
    expect(result.types[0]).toMatchObject({ previous: { total: 20 }, previousCount: 2,
      recentCount: 4, trendComparable: false, change: null })
    expect(result.improvement).toBeNull()
  })

  it('두 복습 유형의 오답은 합집합으로 계산하고 미분류 오답도 분모에 포함한다', () => {
    const otherTag = { ...tag, id: 'other', name: '순서' }
    const result = buildShareAnalysis([
      answer('a', 'w', false, [tag, tag, otherTag]), answer('b', 'w', false, [otherTag]),
      answer('c', 'w', false, []), answer('d', 'w', true, [tag]),
    ], [week('w')])
    expect(result.concentration).toEqual({ typeIds: ['other', tag.id], names: ['순서', tag.name],
      wrong: 2, totalWrong: 3, share: 67 })
    expect(result.types.find((type) => type.id === tag.id)?.total).toBe(2)
  })

  it('추천은 최대 세 유형이며 기간 분류 다음에 누적 Wilson 근거를 따른다', () => {
    const result = buildShareAnalysis([
      ...aggregate('large', 30, 15), ...aggregate('rare', 1, 0, 1),
      ...aggregate('high', 12, 0), ...aggregate('low', 12, 9),
    ], period(3))
    expect(result.priorities.map((type) => type.id)).toEqual(['high', 'large', 'low'])
    expect(result.concentration?.typeIds).toEqual(['high', 'large'])
    expect(result.priorities.every((type) => type.status !== 'insufficient')).toBe(true)
  })

  it('강점에는 기간과 최근 모두 최소 기록을 충족하고 각 최근 회차가 안정적이어야 한다', () => {
    const result = buildShareAnalysis([
      ...aggregate('once', 20, 20, 1), ...aggregate('few', 9, 9), ...aggregate('steady', 12, 12),
    ], period(3))
    expect(result.strength).toMatchObject({ id: 'steady', total: 12, recent: { rate: 100 },
      status: 'stable', recentStatus: 'stable', recentCount: 3 })
    expect(result).toMatchObject({ focus: null, concentration: null, priorities: [] })
  })

  it('기간 성취가 높아도 최근 결과가 80% 미만이면 강점으로 추천하지 않는다', () => {
    const result = comparison(100, 100, 12, 20)
    expect(result.types[0]).toMatchObject({ status: 'stable', recentStatus: 'review', recent: { rate: 60 } })
    expect(result.strength).toBeNull()
  })

  it('최근 합산이 80% 이상이어도 최신 한 회차를 모두 틀렸으면 강점으로 추천하지 않는다', () => {
    const result = buildShareAnalysis(appearances(tag.id, [
      { total: 5, correct: 5 }, { total: 5, correct: 5 }, { total: 5, correct: 5 }, { total: 1, correct: 0 },
    ]), period(4))
    expect(result.types[0]).toMatchObject({ status: 'stable', recentStatus: 'stable', recent: { rate: 94 } })
    expect(result.strength).toBeNull()
  })

  it('기간이 안정적이고 최근 네 회차가 모두 안정적이면 더 오래된 한 번의 실패가 강점을 막지 않는다', () => {
    const result = buildShareAnalysis(appearances(tag.id, [
      { total: 1, correct: 0 }, ...Array.from({ length: 7 }, () => ({ total: 5, correct: 5 })),
    ]), period(8))
    expect(result.strength).toMatchObject({ id: tag.id, cumulative: { total: 36, correct: 35 }, recent: { rate: 100 } })
  })

  it('여러 유형을 기간 누적으로 분류하고 현재 보완할 유형이 있으면 기록 부족을 추천에 섞지 않는다', () => {
    const cases = [
      { id: 'stable', correct: 19, total: 20 }, { id: 'insufficient', correct: 0, total: 1 },
      { id: 'review', correct: 7, total: 10 }, { id: 'priority', correct: 5, total: 10 },
    ]
    const result = buildShareAnalysis(cases.flatMap((item) => aggregate(item.id, item.total, item.correct)), period(3))
    expect(result.types.map((type) => [type.id, type.status])).toEqual([
      ['priority', 'priority'], ['review', 'review'], ['insufficient', 'insufficient'], ['stable', 'stable'],
    ])
    expect(result.priorities.map((type) => type.id)).toEqual(['priority', 'review'])
    expect(result.statusCounts).toEqual({ priority: 1, review: 1, stable: 1, insufficient: 1 })
    expect(ANALYSIS_STATUS_LABELS).toEqual({ priority: '우선 보완', review: '복습 권장', stable: '안정적', insufficient: '기록 부족' })
  })

  it('누적 분류의 60%·80% 경계는 표시용 반올림에 영향을 받지 않는다', () => {
    const cases = [
      { id: 'below60', correct: 119, total: 200, status: 'priority', displayed: 60 },
      { id: 'at60', correct: 6, total: 10, status: 'review', displayed: 60 },
      { id: 'below80', correct: 159, total: 200, status: 'review', displayed: 80 },
      { id: 'at80', correct: 8, total: 10, status: 'stable', displayed: 80 },
    ]
    const result = buildShareAnalysis(cases.flatMap((item) => aggregate(item.id, item.total, item.correct)), period(3))
    for (const item of cases) expect(result.types.find((type) => type.id === item.id)).toMatchObject({
      status: item.status, cumulative: { rate: item.displayed }, recentStatus: item.status,
    })
  })

  it('최소 3회 출제와 10문항을 모두 충족해야 기간·최근 상태를 분류한다', () => {
    expect([ANALYSIS_MIN_APPEARANCES, ANALYSIS_MIN_QUESTIONS, ANALYSIS_RECENT_APPEARANCES]).toEqual([3, 10, 4])
    const cases = [
      { id: 'nine', correct: 6, total: 9, count: 3, status: 'insufficient' },
      { id: 'two', correct: 6, total: 10, count: 2, status: 'insufficient' },
      { id: 'ten', correct: 6, total: 10, count: 3, status: 'review' },
    ]
    const result = buildShareAnalysis(cases.flatMap((item) => aggregate(item.id, item.total, item.correct, item.count)), period(3))
    for (const item of cases) expect(result.types.find((type) => type.id === item.id)).toMatchObject({
      status: item.status, recentStatus: item.status,
    })
    expect(result.priorities.map((type) => type.id)).toEqual(['ten'])
  })

  it('충분한 기록의 15%p 하락은 추이로 설명하되 누적 복습 권장을 우선 보완으로 승격하지 않는다', () => {
    const result = comparison(84, 100, 69, 100)
    expect(result.types[0]).toMatchObject({ change: -15, cumulative: { rate: 77 }, status: 'review', recentStatus: 'review' })
    expect(result.headline).toContain('최근 정답률이 낮아졌어요')
    expect(result.description).toContain('15%p 낮아졌어요')
  })

  it('표시상 15%p 변화여도 실제 변화가 작으면 하락·개선으로 확정하지 않는다', () => {
    const decline = comparison(209, 250, 69, 100)
    expect(decline.types[0]).toMatchObject({ change: -15, status: 'review', trendComparable: true })
    expect(decline.headline).not.toContain('낮아졌어요')
    const improvement = comparison(69, 100, 209, 250)
    expect(improvement.types[0]).toMatchObject({ change: 15, recentStatus: 'stable' })
    expect(improvement.improvement).toBeNull()
    expect(comparison(69, 100, 84, 100).improvement).toMatchObject({ change: 15 })
  })

  it('95% 정답 유형의 남은 오답을 약점이나 반복 오답으로 강조하지 않는다', () => {
    const result = buildShareAnalysis(aggregate(tag.id, 20, 19, 3, 1, tag.name), period(3))
    expect(result.focus).toMatchObject({ status: 'stable', cumulative: { rate: 95, wrong: 1 } })
    expect(result.headline).toContain('남은 오답만 확인해요')
    expect(result.headline).not.toContain('오답이 반복')
    expect(result.focus?.reason).toContain('누적 정답률은 95%')
    expect(result.focus?.reason).not.toContain('복습을 권해요')
  })

  it('현재 보완할 유형이 없으면 기록 부족 오답부터 확인하고 없을 때 기간의 남은 오답을 보여준다', () => {
    const stableAnswers = aggregate(tag.id, 20, 19)
    const result = buildShareAnalysis([...stableAnswers, ...aggregate('few', 1, 0, 1)], period(3))
    expect(result.priorities.map((type) => type.id)).toEqual(['few'])
    expect(buildShareAnalysis(stableAnswers, period(3)).priorities.map((type) => type.id)).toEqual([tag.id])
  })

  it('기간이 안정적이어도 최근 충분한 기록이 낮으면 최근 주의 유형을 보완 추천에서 먼저 보여준다', () => {
    const concern = appearances('concern', [
      ...Array.from({ length: 4 }, () => ({ total: 25, correct: 25 })),
      ...Array.from({ length: 4 }, () => ({ total: 5, correct: 1 })),
    ], '최근 주의')
    const result = buildShareAnalysis([
      ...concern, ...['weak1', 'weak2', 'weak3'].flatMap((id) => aggregate(id, 15, 6)),
    ], period(8))
    expect(result.types.find((type) => type.id === 'concern')).toMatchObject({
      status: 'stable', cumulative: { rate: 87 }, recentStatus: 'priority', recent: { rate: 20 },
    })
    expect(result.types[0].status).toBe('priority')
    expect(result.priorities).toHaveLength(3)
    expect(result.focus?.id).toBe('concern')
    expect(result.headline).toContain('최근 결과를 확인해요')
    expect(result.description).toContain('최근 4회 출제에서는 20문항 중 16문항')
    expect(result.strength).toBeNull()
  })

  it('최근 주의 유형끼리는 최근 Wilson 근거로 순서를 정한다', () => {
    const first = appearances('smaller', [
      ...Array.from({ length: 4 }, () => ({ total: 25, correct: 25 })),
      ...[2, 1, 1, 1].map((correct) => ({ total: 3, correct })),
    ])
    const second = appearances('larger', [
      ...Array.from({ length: 4 }, () => ({ total: 50, correct: 50 })),
      ...Array.from({ length: 4 }, () => ({ total: 5, correct: 2 })),
    ])
    const result = buildShareAnalysis([...first, ...second], period(8))
    expect(result.priorities.map((type) => type.id)).toEqual(['larger', 'smaller'])
  })

  it('최근 주의 유형의 최근 Wilson 근거가 같으면 누적 Wilson 근거로 비교한다', () => {
    const counts = Array.from({ length: 4 }, () => ({ total: 5, correct: 2 }))
    const result = buildShareAnalysis([
      ...appearances('short', [...Array.from({ length: 4 }, () => ({ total: 25, correct: 25 })), ...counts]),
      ...appearances('long', [...Array.from({ length: 4 }, () => ({ total: 50, correct: 50 })), ...counts]),
    ], period(8))
    expect(result.priorities.map((type) => type.id)).toEqual(['short', 'long'])
  })
})
