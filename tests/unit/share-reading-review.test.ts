// 진단평가 "다시 풀기" 대상 선별.
//
// 화면에 고를 선지가 없는 문항을 넣으면 플로우가 빈 카드로 멈춘다.
// CTA 의 문항 수도 이 함수 결과로 세므로, 여기서 거르는 기준이 곧 계약이다.

import { describe, expect, it } from 'vitest'
import { buildReviewQuestions } from '@/app/share/[token]/reading-review'
import type { StudentAnswer } from '@/app/share/[token]/share-types'

function answer(over: Record<string, unknown> = {}, q: Record<string, unknown> = {}): StudentAnswer {
  return {
    id: 'a1',
    week_score_id: 's1',
    is_correct: false,
    student_answer: 3,
    student_answer_text: null,
    ai_feedback: null,
    ...over,
    exam_question: {
      id: 'q1',
      week_id: 'w1',
      question_number: 18,
      sub_label: null,
      exam_type: 'reading',
      question_style: 'objective',
      correct_answer: 5,
      correct_answer_text: null,
      choices: ['①안', '②안', '③안', '④안', '⑤안'],
      explanation: '마지막 문단이 요청이다.',
      passage: '지문입니다.',
      question_stem: '다음 글의 목적은?',
      exam_question_tag: [{ concept_tag: { id: 't1', name: '글의 목적', category_id: null, category_name: null } }],
      ...q,
    },
  } as unknown as StudentAnswer
}

describe('buildReviewQuestions', () => {
  it('선지·정답이 갖춰진 객관식 오답만 고른다', () => {
    const result = buildReviewQuestions([answer()])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      number: 18,
      typeName: '글의 목적',
      stem: '다음 글의 목적은?',
      correct: 5,
      mine: 3,
    })
  })

  it('맞힌 문항·단어 시험은 제외한다', () => {
    expect(buildReviewQuestions([answer({ is_correct: true })])).toEqual([])
    expect(buildReviewQuestions([answer({}, { exam_type: 'vocab' })])).toEqual([])
  })

  it('고를 게 없는 문항은 제외한다 — 서술형·OX·선지 미저장·정답 없음', () => {
    expect(buildReviewQuestions([answer({}, { question_style: 'subjective' })])).toEqual([])
    expect(buildReviewQuestions([answer({}, { question_style: 'ox' })])).toEqual([])
    expect(buildReviewQuestions([answer({}, { choices: null })])).toEqual([])
    expect(buildReviewQuestions([answer({}, { choices: ['하나뿐'] })])).toEqual([])
    expect(buildReviewQuestions([answer({}, { correct_answer: null })])).toEqual([])
  })

  it('발문이 비면 통짜 question_text 로, 그것도 없으면 문항 번호로 대체한다', () => {
    expect(buildReviewQuestions([answer({}, { question_stem: null, question_text: '통짜 발문' })])[0].stem)
      .toBe('통짜 발문')
    expect(buildReviewQuestions([answer({}, { question_stem: null, question_text: null })])[0].stem)
      .toBe('18번')
  })

  it('문항 번호 순으로 정렬한다', () => {
    const list = buildReviewQuestions([
      answer({ id: 'b' }, { question_number: 30 }),
      answer({ id: 'a' }, { question_number: 12 }),
    ])
    expect(list.map((q) => q.number)).toEqual([12, 30])
  })
})
