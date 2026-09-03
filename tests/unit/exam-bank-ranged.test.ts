import { describe, expect, it } from 'vitest'
import { isChartShellQuestion } from '@/lib/llm/exam-bank'
import { findMissingNumbers } from '@/lib/llm/ranged'

// 범위 지시("25~29번만 출력")가 프롬프트의 도표 제외 규칙을 이기고 지문 없는 도표 문항을
// 출력하는 실측 사례(모평 25번) 대응 — 병합 단계에서 코드로 결정적으로 걸러야 한다.
describe('isChartShellQuestion', () => {
  it('지문 없는 도표 문항은 껍데기로 판별한다 (실측: 모평 25번)', () => {
    expect(isChartShellQuestion({ passage: '', question_text: '다음 도표의 내용과 일치하지 않는 것은?' })).toBe(true)
    expect(isChartShellQuestion({ passage: '  ', question_text: '위 그래프에 관한 설명으로 옳은 것은?' })).toBe(true)
  })

  it('지문이 있으면 발문에 도표가 언급돼도 살린다 (표를 글로 풀어쓴 문항)', () => {
    expect(isChartShellQuestion({ passage: 'The chart shows...', question_text: '다음 도표의 내용과 일치하지 않는 것은?' })).toBe(false)
  })

  it('지문 없는 일반 문항(안내문 등)은 거르지 않는다', () => {
    expect(isChartShellQuestion({ passage: '', question_text: '다음 글의 목적으로 가장 적절한 것은?' })).toBe(false)
  })
})

describe('findMissingNumbers — 범위 콜의 조용한 결손 감지', () => {
  it('발견됐는데 결과에 없는 번호만 돌려준다', () => {
    const items = [{ question_number: 1 }, { question_number: 2 }, { question_number: 5 }]
    expect(findMissingNumbers([1, 2, 3, 4, 5], items, [])).toEqual([3, 4])
  })

  it('필터로 이미 결손 처리된 번호는 다시 세지 않는다', () => {
    expect(findMissingNumbers([1, 2, 3], [{ question_number: 1 }], [3])).toEqual([2])
  })

  it('소문항이 붙은 번호도 주 번호로 잡는다', () => {
    const items = [{ question_number: 6, sub_label: 'a' }, { question_number: 6, sub_label: 'b' }]
    expect(findMissingNumbers([6, 7], items, [])).toEqual([7])
  })

  it('문자열 번호도 같은 번호로 본다 (LLM 이 "4" 로 내는 경우)', () => {
    expect(findMissingNumbers([4], [{ question_number: '4' }], [])).toEqual([])
  })

  it('빠진 게 없으면 빈 배열', () => {
    expect(findMissingNumbers([1, 2], [{ question_number: 1 }, { question_number: 2 }], [])).toEqual([])
  })
})
