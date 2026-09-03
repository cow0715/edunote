// LLM 파싱 결과의 저장 전 정규화.
//
// 프롬프트 편차(기호 유무·빈 값 표기·정답키 표기)를 여기서 흡수하므로,
// 이 테스트가 곧 "컬럼에 어떤 형태만 들어가는가" 의 계약이다.

import { describe, expect, it } from 'vitest'
import type { ParsedAnswer } from '@/lib/llm/week'
import {
  deriveStructureFromQuestionText,
  normalizeChoices,
  normalizeMultiSelectKey,
  normalizeParsedAnswerShape,
  stripChoiceMarker,
} from '@/lib/parsed-answer-normalize'

function answer(over: Partial<ParsedAnswer> = {}): ParsedAnswer {
  return {
    question_number: 1,
    sub_label: null,
    question_style: 'objective',
    question_type: null,
    correct_answer: 3,
    correct_answer_text: null,
    grading_criteria: null,
    explanation: null,
    question_text: null,
    ...over,
  }
}

describe('stripChoiceMarker / normalizeChoices', () => {
  it('원문자·숫자 기호를 벗기고 내용만 남긴다', () => {
    expect(stripChoiceMarker('① 감사')).toBe('감사')
    expect(stripChoiceMarker('1. 감사')).toBe('감사')
    expect(stripChoiceMarker('1) 감사')).toBe('감사')
    expect(stripChoiceMarker('감사')).toBe('감사')
  })

  it('기호 유무가 섞여 와도 같은 형태가 된다 — 70번/249번 규칙 충돌을 흡수', () => {
    expect(normalizeChoices(['① However', 'Therefore', '③ Thus'])).toEqual(['However', 'Therefore', 'Thus'])
  })

  it('빈 배열·1개·배열 아님은 전부 null — "없음" 의 표기를 하나로', () => {
    expect(normalizeChoices([])).toBeNull()
    expect(normalizeChoices(['하나뿐'])).toBeNull()
    expect(normalizeChoices(null)).toBeNull()
    expect(normalizeChoices(undefined)).toBeNull()
    expect(normalizeChoices('① a\n② b')).toBeNull()
  })

  it('기호뿐인 선지는 기호를 남긴다 — 문장 삽입 위치는 텍스트가 없다', () => {
    expect(stripChoiceMarker('①')).toBe('①')
    expect(stripChoiceMarker('( ③ )')).toBe('③')
    expect(normalizeChoices(['①', '②', '③', '④', '⑤'])).toEqual(['①', '②', '③', '④', '⑤'])
  })

  it('빈 문자열 항목은 버리고 남은 게 2개 미만이면 null', () => {
    expect(normalizeChoices(['a', '', '  '])).toBeNull()
    expect(normalizeChoices(['a', '', 'b'])).toEqual(['a', 'b'])
  })
})

describe('normalizeMultiSelectKey', () => {
  it('원문자·괄호·대문자를 채점기 기준 표기로 맞춘다', () => {
    expect(normalizeMultiSelectKey('①,③')).toBe('1,3')
    expect(normalizeMultiSelectKey('1, 3')).toBe('1,3')
    expect(normalizeMultiSelectKey('(b), (d)')).toBe('b,d')
    expect(normalizeMultiSelectKey('A,C')).toBe('a,c')
    expect(normalizeMultiSelectKey('ⓐ ⓒ ⓕ')).toBe('a,c,f')
  })

  it('순서는 원문대로, 중복만 뺀다', () => {
    expect(normalizeMultiSelectKey('3,1,3')).toBe('3,1')
  })

  it('비면 null', () => {
    expect(normalizeMultiSelectKey('')).toBeNull()
    expect(normalizeMultiSelectKey(null)).toBeNull()
  })
})

describe('deriveStructureFromQuestionText', () => {
  it('빈 줄로 나뉜 발문/지문/선지는 분해한다', () => {
    const text = '다음 글의 목적은?\n\nDear Mr. Harrison,\nI am writing...\n\n① 감사\n② 항의\n③ 안내'
    expect(deriveStructureFromQuestionText(text)).toEqual({
      question_stem: '다음 글의 목적은?',
      passage: 'Dear Mr. Harrison,\nI am writing...',
      choices: ['감사', '항의', '안내'],
    })
  })

  it('줄바꿈 하나로 이어진 통짜는 분해하지 않는다 — 발문 자리에 전문이 들어가는 걸 막는다', () => {
    expect(deriveStructureFromQuestionText('다음 글의 목적은?\nDear Mr. Harrison,\n① 감사\n② 항의')).toBeNull()
  })

  it('지문 없이 선지만 분리돼도 구조로 인정한다', () => {
    expect(deriveStructureFromQuestionText('빈칸에 알맞은 것은?\n\n① a\n② b')).toEqual({
      question_stem: '빈칸에 알맞은 것은?',
      passage: null,
      choices: ['a', 'b'],
    })
  })
})

describe('normalizeParsedAnswerShape', () => {
  it('공백뿐인 문자열 필드는 전부 null', () => {
    const out = normalizeParsedAnswerShape(answer({
      question_stem: '  ', passage: '', explanation: ' \n', grading_criteria: '', question_text: '   ',
    }))
    expect(out.question_stem).toBeNull()
    expect(out.passage).toBeNull()
    expect(out.explanation).toBeNull()
    expect(out.grading_criteria).toBeNull()
    expect(out.question_text).toBeNull()
  })

  it('objective 가 아니면 correct_answer 는 0 — 파서 잔재 숫자를 지운다', () => {
    expect(normalizeParsedAnswerShape(answer({ question_style: 'subjective', correct_answer: 4, correct_answer_text: 'went' })).correct_answer).toBe(0)
    expect(normalizeParsedAnswerShape(answer({ question_style: 'ox', correct_answer: 2, correct_answer_text: 'O' })).correct_answer).toBe(0)
    expect(normalizeParsedAnswerShape(answer({ question_style: 'objective', correct_answer: 4 })).correct_answer).toBe(4)
  })

  it('multi_select 정답키는 표기를 맞추고, ox 는 공백만 정리한다', () => {
    expect(normalizeParsedAnswerShape(answer({ question_style: 'multi_select', correct_answer_text: '②, ④' })).correct_answer_text).toBe('2,4')
    expect(normalizeParsedAnswerShape(answer({ question_style: 'ox', correct_answer_text: 'X  (were →  was)' })).correct_answer_text).toBe('X (were → was)')
  })

  it('조각이 있으면 통짜에서 분해하지 않는다', () => {
    const out = normalizeParsedAnswerShape(answer({
      question_stem: '발문', passage: null,
      question_text: '다른 발문\n\n지문\n\n① a\n② b',
    }))
    expect(out.question_stem).toBe('발문')
    expect(out.choices).toBeNull()
  })

  it('조각이 전부 비었고 통짜에 구조가 있으면 분해해서 채운다', () => {
    const out = normalizeParsedAnswerShape(answer({
      question_stem: null, passage: null, choices: null,
      question_text: '다음 글의 목적은?\n\n지문입니다.\n\n① 감사\n② 항의',
    }))
    expect(out.question_stem).toBe('다음 글의 목적은?')
    expect(out.passage).toBe('지문입니다.')
    expect(out.choices).toEqual(['감사', '항의'])
  })

  it('분해로 얻은 선지는 파서가 준 선지가 없을 때만 쓴다', () => {
    const out = normalizeParsedAnswerShape(answer({
      question_stem: null, passage: null, choices: ['x', 'y'],
      question_text: '발문\n\n지문\n\n① a\n② b',
    }))
    expect(out.choices).toEqual(['x', 'y'])
  })

  it('선지는 객관식·multi_select 에만 — find_error/서술형/OX 에 실려 온 후보는 버린다', () => {
    expect(normalizeParsedAnswerShape(answer({ question_style: 'find_error', correct_answer_text: 'c:asked', choices: ['ⓐ x', 'ⓑ y', 'ⓒ z'] })).choices).toBeNull()
    expect(normalizeParsedAnswerShape(answer({ question_style: 'subjective', correct_answer_text: 'went', choices: ['a', 'b'] })).choices).toBeNull()
    expect(normalizeParsedAnswerShape(answer({ question_style: 'multi_select', correct_answer_text: '1,3', choices: ['a', 'b', 'c'] })).choices).toEqual(['a', 'b', 'c'])
  })

  it('선지 기호는 벗겨서 저장한다', () => {
    expect(normalizeParsedAnswerShape(answer({ choices: ['① a', '② b'] })).choices).toEqual(['a', 'b'])
  })
})
