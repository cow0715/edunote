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
      numberLabel: '18번',
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

  it('고를 게 없는 문항은 제외한다 — 서술형·선지 미저장·정답 없음', () => {
    expect(buildReviewQuestions([answer({}, { question_style: 'subjective' })])).toEqual([])
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

  // ── OX ──────────────────────────────────────────────────────────────────
  // OX 는 선지가 저장돼 있지 않아도 정답키에서 두 선택지를 만든다.
  // 개발 DB 기준 reading 오답의 상당수가 OX 라서, 빼면 다시풀기 대상이 크게 줄었다.
  it('OX 는 선지가 없어도 정답키로 T/F 선택지를 만든다', () => {
    const [q] = buildReviewQuestions([
      answer({ ox_selection: 'O' }, { question_style: 'ox', choices: null, correct_answer: null, correct_answer_text: 'F' }),
    ])
    expect(q).toMatchObject({
      choices: ['맞는 문장', '틀린 문장'],
      markers: ['T', 'F'],
      correct: 2,
      mine: 1,
    })
  })

  it('O/X 표기 정답키는 O/X 기호를 쓴다', () => {
    const [q] = buildReviewQuestions([
      answer({ ox_selection: 'X' }, { question_style: 'ox', choices: null, correct_answer: null, correct_answer_text: 'O' }),
    ])
    expect(q.markers).toEqual(['O', 'X'])
    expect(q.correct).toBe(1)
    expect(q.mine).toBe(2)
  })

  it('수정어가 있는 정답키는 판정만 묻고 수정어는 정답 옆에 적어둔다', () => {
    const [q] = buildReviewQuestions([
      answer({}, { question_style: 'ox', choices: null, correct_answer: null, correct_answer_text: 'X (were → was)' }),
    ])
    expect(q.correct).toBe(2)
    expect(q.answerNote).toBe('수정 was')
  })

  it('아무것도 안 고른 OX 는 mine 이 null', () => {
    const [q] = buildReviewQuestions([
      answer({ ox_selection: null }, { question_style: 'ox', choices: null, correct_answer: null, correct_answer_text: 'T' }),
    ])
    expect(q.mine).toBeNull()
  })

  it('정답키를 못 읽는 OX 는 제외한다', () => {
    expect(buildReviewQuestions([
      answer({}, { question_style: 'ox', choices: null, correct_answer: null, correct_answer_text: null }),
    ])).toEqual([])
  })

  it('밑줄 OX 는 지문 기호와 같은 원문자로 부른다 (sub_label 이 없는 유형)', () => {
    const [q] = buildReviewQuestions([
      answer({}, { question_style: 'ox', question_number: 3, choices: null, correct_answer: null, correct_answer_text: 'O' }),
    ])
    expect(q.numberLabel).toBe('③')
  })

  it('소문항이 있으면 문항번호에 붙여 부른다', () => {
    const [q] = buildReviewQuestions([answer({}, { sub_label: 'a' })])
    expect(q.numberLabel).toBe('18번a')
  })

  // ── 밑줄 친 낱말 유형 ────────────────────────────────────────────────────
  // 선지 목록이 따로 없고 ①~⑤ 가 지문 안 밑줄에 붙는 유형. 파싱이 일부러 그렇게 한다.
  // 번호만 고르면 되므로 텍스트 없는 번호 버튼으로 살린다.
  it('지문에 밑줄 기호가 있으면 선지 없이도 번호로 고를 수 있다', () => {
    const [q] = buildReviewQuestions([answer({}, {
      question_style: 'objective',
      choices: null,
      correct_answer: 4,
      question_stem: '다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?',
      passage: 'We ① adjust to ② new things and ③ go back to our ④ default level of ⑤ wellbeing.',
    })])
    expect(q.layout).toBe('markers')
    expect(q.choices).toHaveLength(5)
    expect(q.correct).toBe(4)
  })

  it('기호가 ① 부터 연속으로 이어질 때만 센다', () => {
    const [q] = buildReviewQuestions([answer({}, {
      question_style: 'objective', choices: null, correct_answer: 2,
      passage: '① 하나 ② 둘 ④ 넷', question_stem: '밑줄 친 것 중 틀린 것은?',
    })])
    expect(q.choices).toHaveLength(2)
  })

  it('정답 번호가 기호 수를 넘으면 선지 유실로 보고 제외한다', () => {
    expect(buildReviewQuestions([answer({}, {
      question_style: 'objective', choices: null, correct_answer: 5,
      passage: '① 하나 ② 둘', question_stem: '내용과 일치하지 않는 것은?',
    })])).toEqual([])
  })

  it('기호가 아예 없으면 제외한다 — 선지가 유실된 진짜 결손', () => {
    expect(buildReviewQuestions([answer({}, {
      question_style: 'objective', choices: null, correct_answer: 5,
      passage: '기호가 없는 지문', question_text: '다음 글의 내용과 일치하지 않는 것은?',
      question_stem: '다음 글의 내용과 일치하지 않는 것은?',
    })])).toEqual([])
  })

  // 구조화 이전 데이터는 지문·발문·선지가 question_text 에 통짜로 들어 있다.
  // 거기서 기호를 세면 평범한 객관식이 밑줄 유형으로 오인돼 화면이 겹친다.
  it('question_stem 이 없는 구 데이터는 밑줄 유형으로 보지 않는다', () => {
    expect(buildReviewQuestions([answer({}, {
      question_style: 'objective', choices: null, correct_answer: 3,
      question_stem: null, passage: null,
      question_text: '다음 글의 내용과 일치하지 않는 것은? 지문... ① 하나 ② 둘 ③ 셋 ④ 넷 ⑤ 다섯',
    })])).toEqual([])
  })

  it('기호가 passage 밖(통짜 본문)에만 있으면 세지 않는다', () => {
    expect(buildReviewQuestions([answer({}, {
      question_style: 'objective', choices: null, correct_answer: 2,
      question_stem: '다음 글의 내용과 일치하지 않는 것은?', passage: '기호 없는 지문',
      question_text: '① 하나 ② 둘 ③ 셋',
    })])).toEqual([])
  })

  it('문항 번호 순으로 정렬한다', () => {
    const list = buildReviewQuestions([
      answer({ id: 'b' }, { question_number: 30 }),
      answer({ id: 'a' }, { question_number: 12 }),
    ])
    expect(list.map((q) => q.number)).toEqual([12, 30])
  })
})
