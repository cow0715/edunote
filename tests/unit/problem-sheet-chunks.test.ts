import { describe, expect, it } from 'vitest'
import { detectExplanationSection, finalizeAnswerKeyItems, finalizeProblemSheetQuestions } from '@/lib/week-reading-import'
import type { ProblemSheetAnswerKeyItem, WeekProblemSheetQuestion } from '@/lib/llm/week'

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

// 정오표 청크 finalize (순수 함수): 청크 순서 병합("뒤가 이긴다") + 기존 문항 매칭 + 수 검증
describe('finalizeAnswerKeyItems', () => {
  const existing = (numbers: number[]) => numbers.map((n) => ({
    id: `id-${n}`,
    question_number: n,
    sub_label: null,
    question_style: 'objective',
    question_text: `${n}번 발문`,
  }))
  const key = (n: number, answer: number): ProblemSheetAnswerKeyItem => ({
    question_number: n,
    question_style: 'objective',
    correct_answer: answer,
    correct_answer_text: null,
  })

  it('같은 번호가 여러 청크에 나오면 뒤의 것이 이긴다', () => {
    const result = finalizeAnswerKeyItems(
      [key(1, 2), key(2, 3), key(1, 5)],
      { existingQuestions: existing([1, 2]), answerableQuestionCount: 2 },
    )
    expect(result.find((a) => a.question_number === 1)?.correct_answer).toBe(5)
  })

  it('기존 문항에 없는 번호는 버린다', () => {
    const result = finalizeAnswerKeyItems(
      [key(1, 2), key(99, 3), key(2, 4)],
      { existingQuestions: existing([1, 2]), answerableQuestionCount: 2 },
    )
    expect(result.map((a) => a.question_number).sort()).toEqual([1, 2])
  })

  it('읽힌 정답 수가 문항 수와 다르면 throw', () => {
    expect(() => finalizeAnswerKeyItems(
      [key(1, 2)],
      { existingQuestions: existing([1, 2, 3]), answerableQuestionCount: 3 },
    )).toThrow(/1\/3문항/)
  })

  it('적용할 정답이 하나도 없으면 throw', () => {
    expect(() => finalizeAnswerKeyItems(
      [key(99, 1)],
      { existingQuestions: existing([1]), answerableQuestionCount: 1 },
    )).toThrow()
  })
})

// 해설 섹션 감지 — 단일 파일 업로드 토글의 기본값 (실물 PDF 텍스트 축약본 기반)
describe('detectExplanationSection', () => {
  it('"정답 및 해설" 헤더 (숭문형 내신)', () => {
    const pages = [
      '1. (A), (B), (C) 각 괄호 안에서 어법에 맞는 표현으로 가장 적절한 것을 고르시오. The group made of...',
      '정답 및 해설 1. (A) made (B) come (C) have [해설] 그룹이 구성된 것이므로 수동 관계를 나타내는 과거분사',
    ]
    expect(detectExplanationSection(pages)).toEqual({ hasExplanation: true, confident: true })
  })

  it('"{해석}{풀이}{어휘}" 마커 (예열TEST형 — 헤더 없는 통합 해설)', () => {
    const pages = [
      '미래탐구 영어 1 다음 글의 제목으로 가장 적절한 것은? Music in the fourteenth century...',
      '미래탐구 영어 Wise English Warm UP TEST (4) 1. 제목 ⑤ {해석} 음악에 대한 14세기 접근법은 그 다음에 이어지는',
    ]
    expect(detectExplanationSection(pages)).toEqual({ hasExplanation: true, confident: true })
  })

  it('문제만 있는 시험지는 해설 없음', () => {
    const pages = [
      '1. 다음 글의 제목으로 가장 적절한 것은? The approach to music... ① Music ② History ③ Change ④ Sound ⑤ Time',
      '5. 다음 글의 내용과 일치하지 않는 것은? Dr. Smith argued that the program was created to help students learn.',
    ]
    expect(detectExplanationSection(pages)).toEqual({ hasExplanation: false, confident: true })
  })

  it('텍스트를 못 읽는 스캔 문서는 confident=false, 기본값 해설 포함', () => {
    expect(detectExplanationSection(null)).toEqual({ hasExplanation: true, confident: false })
    expect(detectExplanationSection(['---- ----', ''])).toEqual({ hasExplanation: true, confident: false })
  })
})

