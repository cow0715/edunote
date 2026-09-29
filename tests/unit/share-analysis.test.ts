import { describe, expect, it } from 'vitest'
import { buildShareAnalysis } from '@/lib/share-analysis'
import { analysisAnswer as answer, analysisWeek as week, analysisTag as tag, analysisFixture } from '../fixtures/share-analysis'

describe('share 분석의 실제 데이터 해석', () => {
  it('누적 오답과 최근 두 출제 회차의 정답률을 따로 계산한다', () => {
    const result = buildShareAnalysis(analysisFixture.studentAnswers, analysisFixture.weeks)
    expect(result.focus).toMatchObject({ id: 'blank', wrong: 3, total: 5 })
    expect(result.headline).toBe('빈칸 추론,\n함께 짚어볼까요?')
    expect(result.trends.find((type) => type.id === 'blank')?.points.map((point) => point.rate)).toEqual([0, 67])
    expect(result.types.find((type) => type.id === 'content')).toMatchObject({ wrong: 0, total: 1 })
    expect(result).toMatchObject({ readingCount: 8, weekCount: 2 })
  })
  it('문항 1개의 100% 오답보다 충분한 기록을 먼저 제안한다', () => {
    const answers = [answer('one', 'w', false, [{ ...tag, id: 'rare', name: '낯선 유형' }]),
      ...Array.from({ length: 10 }, (_, i) => answer(String(i), 'w', i >= 5))]
    expect(buildShareAnalysis(answers, [week('w')]).focus?.id).toBe('blank')
    const small = buildShareAnalysis(answers.slice(0, 1), [week('w')])
    expect(small.description).toContain('아직 출제 수가 적어요')
    expect(small.trends).toEqual([])
  })
  it('전부 정답, 유형 미분류, 미등록을 서로 구분한다', () => {
    expect(buildShareAnalysis([answer('a', 'w', true)], [week('w')]).headline).toContain('모두 맞혔어요')
    const untagged = buildShareAnalysis([answer('a', 'w', false, [])], [week('w')])
    expect(untagged).toMatchObject({ focus: null, wrongCount: 1, untaggedCount: 1 })
    expect(untagged.headline).toContain('틀린 문제')
    expect(buildShareAnalysis([], [week('w')]).headline).toContain('기록이 쌓이면')
  })
  it('기간 밖 답과 단어 답을 제외하고 중복 태그를 한 번만 센다', () => {
    const vocab = answer('v', 'w', false)
    vocab.exam_question!.exam_type = 'vocab'
    const result = buildShareAnalysis([answer('a', 'w', false, [tag, tag]), answer('b', 'outside', false), vocab], [week('w')])
    expect(result.readingCount).toBe(1)
    expect(result.types[0].total).toBe(1)
  })
  it('같은 회차 번호인 다른 수업을 합치지 않고 미출제를 0%로 채우지 않는다', () => {
    const result = buildShareAnalysis([answer('b', 'b', true), answer('a', 'a', false)],
      [week('b', 1, '2026-09-24'), week('missing', 2, '2026-09-20'), week('a', 1, '2026-09-17')])
    expect(result.types[0].points.map((point) => [point.weekId, point.rate])).toEqual([['a', 0], ['b', 100]])
  })
})
