import { describe, expect, it } from 'vitest'
import { finalizeProblemSheetQuestions } from '@/lib/week-reading-import'
import type { WeekProblemSheetQuestion } from '@/lib/llm/week'

// 문제지형 청크 분리 가져오기의 finalize (순수 함수):
// 청크들을 페이지 순서로 합쳐 번호 재배정·지문 전파를 "전역으로" 적용하는지 검증.
// 청크별 저장(import-chunk)이 후처리를 건너뛰는 대신 여기서 반드시 한 번에 돌아야 한다.

function q(partial: Partial<WeekProblemSheetQuestion> & { question_number: number }): WeekProblemSheetQuestion {
  return {
    question_type: null,
    question_style: 'objective',
    passage: '',
    question_text: '발문',
    choices: ['① 가', '② 나'],
    ...partial,
  }
}

describe('finalizeProblemSheetQuestions', () => {
  it('청크 순서대로 합쳐 ParsedAnswer 로 변환한다', () => {
    const result = finalizeProblemSheetQuestions([
      [q({ question_number: 1 }), q({ question_number: 2 })],
      [q({ question_number: 3 })],
    ])
    expect(result.map((a) => a.question_number)).toEqual([1, 2, 3])
    expect(result[0].correct_answer).toBe(0) // 구조만 — 정답은 정오표 단계
    expect(result[0].question_style).toBe('objective')
  })

  it('청크 경계에서 중복된 번호를 전역으로 재배정한다', () => {
    // 청크2가 번호를 오독해 1을 다시 내놓은 경우 — 안 쓰인 가장 작은 번호로 재배정
    const result = finalizeProblemSheetQuestions([
      [q({ question_number: 1 }), q({ question_number: 2 })],
      [q({ question_number: 1 }), q({ question_number: 4 })],
    ])
    expect(result.map((a) => a.question_number)).toEqual([1, 2, 3, 4])
  })

  it('청크 경계에 걸친 지문 공유 세트에 직전 지문을 전파한다', () => {
    const result = finalizeProblemSheetQuestions([
      [q({ question_number: 6, passage: '공유 지문 본문' })],
      [q({ question_number: 7, passage: '', question_text: '윗글의 제목으로 가장 적절한 것은?' })],
    ])
    expect(result[1].passage).toBe('공유 지문 본문')
  })

  it('발문에 앞 지문 근거가 없으면 빈 지문을 채우지 않는다', () => {
    const result = finalizeProblemSheetQuestions([
      [q({ question_number: 1, passage: '지문 A' })],
      [q({ question_number: 2, passage: '', question_text: '다음 중 어법상 옳은 것은?' })],
    ])
    expect(result[1].passage ?? '').toBe('') // 전파 안 됨 (빈 지문은 null 로 정규화)
  })

  it('전 청크가 비면 throw', () => {
    expect(() => finalizeProblemSheetQuestions([[], []])).toThrow()
  })
})
