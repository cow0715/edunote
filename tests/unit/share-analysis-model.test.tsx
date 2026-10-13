// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useShareModel } from '@/app/share/[token]/use-share-model'
import { analysisAnswer, analysisData, analysisTag, analysisWeek } from '../fixtures/share-analysis'

afterEach(cleanup)

describe('공유 분석 모델의 입력 범위', () => {
  it('선택 기간 밖의 답은 유형 집계, 영역 표시 방식, 반복 약점에서 제외한다', () => {
    const outsideTag = { ...analysisTag, id: 'outside', name: '기간 밖 유형', category_id: 'grammar', category_name: '문법 유형' }
    const outside = analysisAnswer('outside', 'outside-week', false, [outsideTag])
    outside.exam_question!.question_style = 'subjective'
    const data = analysisData([
      analysisAnswer('a', 'w1', false), analysisAnswer('b', 'w1', false),
      analysisAnswer('c', 'w2', false), analysisAnswer('d', 'w2', false),
      outside,
      analysisAnswer('outside-2', 'outside-week-2', false, [outsideTag]),
      analysisAnswer('outside-3', 'outside-week-2', false, [outsideTag]),
      analysisAnswer('outside-4', 'outside-week', false, [outsideTag]),
    ], [analysisWeek('w1', 1), analysisWeek('w2', 2)])
    const { result } = renderHook(() => useShareModel(data))

    expect(result.current.analysisSummary.readingCount).toBe(4)
    expect(result.current.analysisSummary.wrongCount).toBe(4)
    expect(result.current.typeData.map(({ id, total }) => ({ id, total }))).toEqual([{ id: analysisTag.id, total: 4 }])
    expect(result.current.expandToDomains).toBe(true)
    expect(result.current.radarData).toEqual([{ name: '독해', rate: 0, correct: 0, total: 4 }])
    expect(result.current.repeatPatterns.map(({ id }) => id)).toEqual([analysisTag.id])
    expect(result.current.topWeakness?.id).toBe(analysisTag.id)
  })

  it('독해가 아닌 답은 분석 집계에 포함하지 않는다', () => {
    const vocab = analysisAnswer('vocab', 'w', false)
    vocab.exam_question!.exam_type = 'vocab'
    const data = analysisData([analysisAnswer('reading', 'w', true), vocab], [analysisWeek('w')])
    const { result } = renderHook(() => useShareModel(data))

    expect(result.current.analysisSummary.readingCount).toBe(1)
    expect(result.current.analysisSummary.wrongCount).toBe(0)
    expect(result.current.radarData).toEqual([{ name: '독해', rate: 100, correct: 1, total: 1 }])
    expect(result.current.repeatPatterns).toEqual([])
  })

  it('중복 태그 때문에 두 문항이 반복 약점의 네 문항 기준을 충족하지 않는다', () => {
    const repeatedTags = [analysisTag, analysisTag, analysisTag]
    const data = analysisData([
      analysisAnswer('a', 'w1', false, repeatedTags),
      analysisAnswer('b', 'w2', false, repeatedTags),
    ], [analysisWeek('w1', 1), analysisWeek('w2', 2)])
    const { result } = renderHook(() => useShareModel(data))

    expect(result.current.typeData[0]).toMatchObject({ total: 2, wrong: 2 })
    expect(result.current.radarData[0]).toMatchObject({ total: 2, correct: 0 })
    expect(result.current.repeatPatterns).toEqual([])
    expect(result.current.topWeakness).toBeNull()
    expect(data.studentAnswers[0].exam_question?.exam_question_tag).toHaveLength(3)
  })

  it('반마다 같은 주차 번호가 있어도 날짜순으로 별도 회차를 비교한다', () => {
    const earlier = { ...analysisWeek('earlier', 4, '2026-09-01'), class_id: 'class-a' }
    const later = { ...analysisWeek('later', 4, '2026-09-08'), class_id: 'class-b' }
    const data = analysisData([
      analysisAnswer('a', later.id, false), analysisAnswer('b', later.id, false),
      analysisAnswer('c', earlier.id, false), analysisAnswer('d', earlier.id, true),
    ], [later, earlier])
    const { result } = renderHook(() => useShareModel(data))

    expect(result.current.repeatPatterns).toHaveLength(1)
    expect(result.current.repeatPatterns[0]).toMatchObject({
      id: analysisTag.id, patternType: 'deteriorating', weekCount: 2,
      overallAccuracy: 25, recentAccuracy: 25, trend: -50,
      weeks: [
        { weekNumber: 1, correct: 1, total: 2, accuracy: 50 },
        { weekNumber: 2, correct: 0, total: 2, accuracy: 0 },
      ],
    })
    expect(result.current.topWeakness?.text).toBe('최근 정답률 25% · 갈수록 낮아지고 있어요')
    expect(result.current.weekNumberByWeekId.get(earlier.id)).toBe(4)
    expect(result.current.weekNumberByWeekId.get(later.id)).toBe(4)
  })
})
