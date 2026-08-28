import { describe, expect, it } from 'vitest'
import { formatNumberRanges } from '@/lib/utils'

// OCR 결손 경고 표시용 — 운영 사고(50문항 중 36~50 누락)를 사람이 읽는 표기로 압축한다

describe('formatNumberRanges', () => {
  it('연속 구간을 ~ 로 압축한다 (운영 실사례: 36~50 연속 누락)', () => {
    expect(formatNumberRanges([36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50])).toBe('36~50')
  })

  it('연속·단독 혼합', () => {
    expect(formatNumberRanges([36, 37, 38, 44, 50])).toBe('36~38, 44, 50')
  })

  it('두 개 연속도 구간으로', () => {
    expect(formatNumberRanges([3, 4])).toBe('3~4')
  })

  it('정렬 안 된 입력·중복을 정리한다', () => {
    expect(formatNumberRanges([5, 1, 2, 2, 3])).toBe('1~3, 5')
  })

  it('단독 하나', () => {
    expect(formatNumberRanges([7])).toBe('7')
  })

  it('빈 목록은 빈 문자열', () => {
    expect(formatNumberRanges([])).toBe('')
  })
})
