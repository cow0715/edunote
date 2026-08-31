// 조합 선택형([분리 X] ②)을 소문항으로 쪼갠 파싱 결과를 되병합하는지.
//
// 프롬프트에도 금지 규칙이 있지만 규칙 도입 이후에도 계속 뚫렸다 (실제 데이터 7문항).
// 프롬프트는 확률이고, 여기가 결정적 관문이다.

import { describe, expect, it } from 'vitest'
import { normalizeParsedAnswers } from '@/lib/week-reading-import'
import type { ParsedAnswer } from '@/lib/llm/week'

function answer(over: Partial<ParsedAnswer> = {}): ParsedAnswer {
  return {
    question_number: 8, sub_label: null, question_style: 'objective', question_type: '요약문',
    correct_answer: 2, correct_answer_text: null, grading_criteria: null,
    explanation: null, question_text: null,
    ...over,
  }
}

const bySub = (rows: ParsedAnswer[]) => rows.map((r) => r.sub_label)

describe('조합 선택형 되병합 — 정답 번호가 한 종류면 합친다', () => {
  it('objective 2개가 같은 정답이면 한 행으로 합친다', () => {
    const out = normalizeParsedAnswers([
      answer({ sub_label: 'a', correct_answer: 2 }),
      answer({ sub_label: 'b', correct_answer: 2 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sub_label).toBeNull()
    expect(out[0].correct_answer).toBe(2)
  })

  it('소문항 3개여도 정답이 같으면 합친다 (보기 묶음형)', () => {
    const out = normalizeParsedAnswers([
      answer({ sub_label: 'a', correct_answer: 4, question_type: '관계사' }),
      answer({ sub_label: 'b', correct_answer: 4, question_type: '분사' }),
      answer({ sub_label: 'c', correct_answer: 4, question_type: '어휘' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].sub_label).toBeNull()
  })

  it('합칠 때 지문이 가장 긴 행을 뼈대로 삼는다', () => {
    const out = normalizeParsedAnswers([
      answer({ sub_label: 'a', question_text: '짧음' }),
      answer({ sub_label: 'b', question_text: '다음 글을 아래와 같이 요약할 때 …(긴 지문)' }),
    ])
    expect(out[0].question_text).toContain('긴 지문')
  })

  it('비어 있는 칸은 형제 행에서 채운다', () => {
    const out = normalizeParsedAnswers([
      answer({ sub_label: 'a', question_text: '지문이 여기 다 있다', explanation: null, question_type: null }),
      answer({ sub_label: 'b', question_text: null, explanation: '(B)는 withstand 가 적절', question_type: '요약문' }),
    ])
    expect(out[0].explanation).toBe('(B)는 withstand 가 적절')
    expect(out[0].question_type).toBe('요약문')
  })
})

describe('조합 선택형 되병합 — 합치면 안 되는 것은 그대로 둔다', () => {
  it("어법 'n개 고르' 는 정답이 서로 달라 분리를 유지한다", () => {
    const out = normalizeParsedAnswers([
      answer({ sub_label: 'a', correct_answer: 2, question_type: 'to부정사' }),
      answer({ sub_label: 'b', correct_answer: 4, question_type: '수의 일치' }),
    ])
    expect(out).toHaveLength(2)
    expect(bySub(out)).toEqual(['a', 'b'])
  })

  it('subjective 복수 빈칸은 정답이 텍스트라 합치지 않는다', () => {
    const out = normalizeParsedAnswers([
      answer({ sub_label: 'a', question_style: 'subjective', correct_answer: 0, correct_answer_text: 'act' }),
      answer({ sub_label: 'b', question_style: 'subjective', correct_answer: 0, correct_answer_text: 'application' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('find_error 는 기호별 분리를 유지한다', () => {
    const out = normalizeParsedAnswers([
      answer({ sub_label: 'c', question_style: 'find_error', correct_answer: 0, correct_answer_text: 'c:asked' }),
      answer({ sub_label: 'e', question_style: 'find_error', correct_answer: 0, correct_answer_text: 'e:watching' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('소문항이 하나뿐이면 건드리지 않는다', () => {
    const out = normalizeParsedAnswers([answer({ sub_label: 'a' })])
    expect(out).toHaveLength(1)
  })

  it('서로 다른 문항 번호는 각각 판정한다', () => {
    const out = normalizeParsedAnswers([
      answer({ question_number: 7, sub_label: 'a', correct_answer: 4 }),
      answer({ question_number: 7, sub_label: 'b', correct_answer: 4 }),   // 합쳐짐
      answer({ question_number: 9, sub_label: 'a', correct_answer: 1 }),
      answer({ question_number: 9, sub_label: 'b', correct_answer: 3 }),   // 유지
    ])
    expect(out.filter((r) => r.question_number === 7)).toHaveLength(1)
    expect(out.filter((r) => r.question_number === 9)).toHaveLength(2)
  })

  it('정답 번호가 범위를 벗어나면 합치지 않는다 (판정 근거가 없음)', () => {
    const out = normalizeParsedAnswers([
      answer({ sub_label: 'a', correct_answer: 0 }),
      answer({ sub_label: 'b', correct_answer: 0 }),
    ])
    expect(out).toHaveLength(2)
  })
})
