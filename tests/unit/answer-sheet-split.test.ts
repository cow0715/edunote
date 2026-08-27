import { describe, expect, it } from 'vitest'
import { findExplanationSectionStartPage, mergeProblemStructureWithAnswerItems } from '@/lib/week-reading-import'
import { pageStartsWithQuestion } from '@/lib/pdf'
import type { ParsedAnswer, WeekProblemSheetQuestion } from '@/lib/llm/week'

// 해설지통합형 분할 파싱: 경계 탐지 → 문항부/해설부 각각 파싱 → 번호 병합.
// 경계 오탐(문항 안 "[해설]" 류 마커)이 가장 위험하다 — 문항부가 해설부로 넘어가면 구조가 통째로 빠진다.

function q(partial: Partial<WeekProblemSheetQuestion> & { question_number: number }): WeekProblemSheetQuestion {
  return {
    question_type: '어법',
    question_style: 'objective',
    passage: '지문 텍스트',
    question_text: '발문',
    choices: ['① 가', '② 나'],
    ...partial,
  }
}

function a(partial: Partial<ParsedAnswer> & { question_number: number }): ParsedAnswer {
  return {
    sub_label: null,
    question_style: 'objective',
    question_type: null,
    correct_answer: 3,
    correct_answer_text: null,
    grading_criteria: null,
    explanation: '해설 텍스트',
    question_text: null,
    ...partial,
  }
}

describe('findExplanationSectionStartPage', () => {
  it('"정답 및 해설" 헤더가 있는 페이지 인덱스를 찾는다 (숭문형: 쪽 머리글 뒤 헤더)', () => {
    const pages = ['1. 문항', '5. 문항', '6 / 7 정답 및 해설 1. (A) made', '7 / 7 8. ① 오답 분석']
    expect(findExplanationSectionStartPage(pages)).toBe(2)
  })

  it('띄어쓰기·연결어 변형("정답과 해설", "정답해설")도 헤더로 인정한다', () => {
    expect(findExplanationSectionStartPage(['문항', '정답과 해설'])).toBe(1)
    expect(findExplanationSectionStartPage(['문항', '정 답 해 설'])).toBe(1)
  })

  it('헤더가 없으면 null — 통짜 폴백', () => {
    expect(findExplanationSectionStartPage(['1. 문항', '2. 문항 [해설] 인라인 마커는 헤더가 아님'])).toBeNull()
  })

  it('첫 페이지의 헤더는 경계가 아니다 (문항부가 없으면 분할 불가)', () => {
    expect(findExplanationSectionStartPage(['정답 및 해설', '1. 해설'])).toBeNull()
  })

  it('페이지 첫머리(160자) 밖의 문구는 헤더로 보지 않는다', () => {
    const deep = `${'x'.repeat(200)} 정답 및 해설`
    expect(findExplanationSectionStartPage(['문항', deep])).toBeNull()
  })
})

describe('mergeProblemStructureWithAnswerItems', () => {
  it('구조는 문항부에서, 정답·해설·유형은 해설부에서 합친다', () => {
    const merged = mergeProblemStructureWithAnswerItems(
      [q({ question_number: 1, passage: 'Dr. Chibanda 지문' })],
      [a({ question_number: 1, correct_answer: 4, explanation: '수동 관계라서' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].correct_answer).toBe(4)
    expect(merged[0].explanation).toBe('수동 관계라서')
    expect(merged[0].passage).toBe('Dr. Chibanda 지문')
    expect(merged[0].question_text).toContain('발문')
  })

  it('해설부의 소문항 분리를 유지하고 같은 구조를 양쪽에 복사한다', () => {
    const merged = mergeProblemStructureWithAnswerItems(
      [q({ question_number: 3, question_style: 'subjective' })],
      [
        a({ question_number: 3, sub_label: 'a', question_style: 'subjective', correct_answer: 0, correct_answer_text: 'made' }),
        a({ question_number: 3, sub_label: 'b', question_style: 'subjective', correct_answer: 0, correct_answer_text: 'come' }),
      ],
    )
    expect(merged).toHaveLength(2)
    expect(merged.map((m) => m.sub_label)).toEqual(['a', 'b'])
    expect(merged.every((m) => m.passage === '지문 텍스트')).toBe(true)
  })

  it('문항부 결손: 해설부에만 있는 번호는 해설부 항목 그대로 남긴다', () => {
    const merged = mergeProblemStructureWithAnswerItems(
      [q({ question_number: 1 })],
      [a({ question_number: 1 }), a({ question_number: 2, explanation: '결손 문항 해설' })],
    )
    expect(merged.map((m) => m.question_number)).toEqual([1, 2])
    expect(merged[1].explanation).toBe('결손 문항 해설')
  })

  it('해설부 결손: 문항부에만 있는 번호는 정답 없이(0) 유지된다', () => {
    const merged = mergeProblemStructureWithAnswerItems(
      [q({ question_number: 1 }), q({ question_number: 2 })],
      [a({ question_number: 2 })],
    )
    expect(merged.map((m) => m.question_number)).toEqual([1, 2])
    expect(merged[0].correct_answer).toBe(0)
  })

  it('문항 유형: 문항부 값을 우선하고 없으면 해설부 값을 쓴다', () => {
    const merged = mergeProblemStructureWithAnswerItems(
      [q({ question_number: 1, question_type: null })],
      [a({ question_number: 1, question_type: '빈칸' })],
    )
    expect(merged[0].question_type).toBe('빈칸')
  })
})

describe('pageStartsWithQuestion — 머리글 스킵', () => {
  it('"n / m 문서코드" 머리글 뒤의 문항 번호를 인식한다 (숭문형)', () => {
    expect(pageStartsWithQuestion('2 / 7 I110:A+REG-0000459717 5. 다음 글의 내용과 일치하지 않는 것은?')).toBe(true)
  })

  it('머리글 없는 기존 형식은 그대로 인식한다', () => {
    expect(pageStartsWithQuestion('18. 다음 글의 목적으로?')).toBe(true)
    expect(pageStartsWithQuestion('[41~45] 다음 글을 읽고')).toBe(true)
  })

  it('문항으로 시작하지 않는 페이지는 여전히 false', () => {
    expect(pageStartsWithQuestion('숭문 Week4 진단평가 추지혜T 선생님 1 / 7')).toBe(false)
    expect(pageStartsWithQuestion('이어지는 지문 본문 the rest of the passage')).toBe(false)
  })
})
