import { describe, expect, it } from 'vitest'
import { isChartShellQuestion } from '@/lib/llm/exam-bank'

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
