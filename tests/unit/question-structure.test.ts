import { describe, expect, it } from 'vitest'
import {
  buildQuestionDisplayText,
  buildQuestionTextFromParts,
  ensureChoiceMarker,
  getStructuredQuestionParts,
  hasChoiceMarker,
  normalizeQuestionChoices,
  splitStoredQuestionText,
} from '@/lib/question-structure'

describe('normalizeQuestionChoices', () => {
  it('배열이 아니면 빈 배열', () => {
    expect(normalizeQuestionChoices(null)).toEqual([])
    expect(normalizeQuestionChoices('a,b')).toEqual([])
  })

  it('문자열만 남기고 트림한다', () => {
    expect(normalizeQuestionChoices(['  a  ', '', 'b', 3, null])).toEqual(['a', 'b'])
  })
})

describe('hasChoiceMarker', () => {
  it('숫자 마커 뒤에 공백이 있어야 인정한다', () => {
    expect(hasChoiceMarker('1. foo')).toBe(true)
    expect(hasChoiceMarker('1) foo')).toBe(true)
    expect(hasChoiceMarker('1.foo')).toBe(false)
  })

  it('원문자 마커도 인정한다', () => {
    expect(hasChoiceMarker('① foo')).toBe(true)
    expect(hasChoiceMarker('⑩ foo')).toBe(true)
  })

  it('마커가 없으면 false', () => {
    expect(hasChoiceMarker('foo')).toBe(false)
  })
})

describe('ensureChoiceMarker', () => {
  it('마커가 없으면 순번에 맞는 원문자를 붙인다', () => {
    expect(ensureChoiceMarker('apple', 0)).toBe('① apple')
    expect(ensureChoiceMarker('banana', 4)).toBe('⑤ banana')
  })

  it('이미 마커가 있으면 그대로 둔다', () => {
    expect(ensureChoiceMarker('③ cherry', 0)).toBe('③ cherry')
  })

  it('원문자 범위(10개)를 넘으면 숫자 마커로 폴백한다', () => {
    expect(ensureChoiceMarker('x', 10)).toBe('11. x')
  })
})

describe('splitStoredQuestionText', () => {
  it('빈 값이면 전부 빈 결과', () => {
    expect(splitStoredQuestionText(null)).toEqual({ questionStem: '', passage: '', choices: [] })
    expect(splitStoredQuestionText('')).toEqual({ questionStem: '', passage: '', choices: [] })
  })

  it('발문 / 지문 / 선택지를 빈 줄 기준으로 나눈다', () => {
    const raw = '다음 글의 요지로 가장 적절한 것은?\n\nThis is the passage.\n\n① 첫째\n② 둘째'
    expect(splitStoredQuestionText(raw)).toEqual({
      questionStem: '다음 글의 요지로 가장 적절한 것은?',
      passage: 'This is the passage.',
      choices: ['첫째', '둘째'],
    })
  })

  it('선택지가 없으면 마지막 블록도 지문으로 본다', () => {
    const raw = '발문\n\n첫 문단\n\n둘째 문단'
    expect(splitStoredQuestionText(raw)).toEqual({
      questionStem: '발문',
      passage: '첫 문단\n\n둘째 문단',
      choices: [],
    })
  })

  it('마지막 블록의 모든 줄이 마커여야 선택지로 인정한다', () => {
    const raw = '발문\n\n① 첫째\n마커 없는 줄'
    expect(splitStoredQuestionText(raw).choices).toEqual([])
  })

  it('CRLF 줄바꿈도 처리한다', () => {
    const raw = '발문\r\n\r\n① 첫째\r\n② 둘째'
    expect(splitStoredQuestionText(raw).choices).toEqual(['첫째', '둘째'])
  })

  it('선택지 마커로 "1)" 형식은 인정하지 않는다 (현재 동작)', () => {
    // hasChoiceMarker 는 "1)" 을 마커로 보지만 splitStoredQuestionText 는 "1." 만 본다.
    const raw = '발문\n\n1) 첫째\n2) 둘째'
    expect(splitStoredQuestionText(raw).choices).toEqual([])
  })
})

describe('buildQuestionTextFromParts', () => {
  it('발문·지문·선택지를 빈 줄로 잇는다', () => {
    expect(buildQuestionTextFromParts({ questionStem: '발문', passage: '지문', choices: ['a', 'b'] })).toBe(
      '발문\n\n지문\n\n① a\n② b'
    )
  })

  it('빈 부분은 건너뛴다', () => {
    expect(buildQuestionTextFromParts({ questionStem: '발문', passage: null, choices: [] })).toBe('발문')
  })

  it('전부 비어있으면 null', () => {
    expect(buildQuestionTextFromParts({ questionStem: '', passage: null, choices: null })).toBeNull()
  })
})

describe('getStructuredQuestionParts', () => {
  it('구조화 필드가 하나라도 있으면 그것을 쓴다', () => {
    expect(
      getStructuredQuestionParts({
        question_stem: '발문',
        passage: null,
        choices: ['a'],
        question_text: '레거시 텍스트',
      })
    ).toEqual({ questionStem: '발문', passage: '', choices: ['a'] })
  })

  it('구조화 필드가 없으면 레거시 question_text 를 파싱한다', () => {
    expect(
      getStructuredQuestionParts({
        question_stem: null,
        passage: null,
        choices: null,
        question_text: '발문\n\n① a\n② b',
      })
    ).toEqual({ questionStem: '발문', passage: '', choices: ['a', 'b'] })
  })

  it('공백만 있는 구조화 필드는 없는 것으로 본다', () => {
    expect(
      getStructuredQuestionParts({
        question_stem: '   ',
        passage: '  ',
        choices: [],
        question_text: '레거시 발문',
      })
    ).toEqual({ questionStem: '레거시 발문', passage: '', choices: [] })
  })
})

describe('buildQuestionDisplayText', () => {
  it('구조화 필드로 표시 텍스트를 만든다', () => {
    expect(
      buildQuestionDisplayText({ question_stem: '발문', passage: '지문', choices: ['a'], question_text: null })
    ).toBe('발문\n\n지문\n\n① a')
  })

  it('구조화 필드도 레거시 파싱도 비면 question_text 원문으로 폴백한다', () => {
    expect(
      buildQuestionDisplayText({ question_stem: null, passage: null, choices: null, question_text: '  단일 발문  ' })
    ).toBe('단일 발문')
  })

  it('아무것도 없으면 빈 문자열', () => {
    expect(buildQuestionDisplayText({ question_stem: null, passage: null, choices: null, question_text: null })).toBe('')
  })
})

describe('build → split 라운드트립', () => {
  it('만든 텍스트를 다시 쪼개면 원래 조각이 나온다', () => {
    const parts = { questionStem: '발문', passage: '지문 첫 줄\n지문 둘째 줄', choices: ['첫째', '둘째', '셋째'] }
    const built = buildQuestionTextFromParts(parts)
    expect(splitStoredQuestionText(built)).toEqual(parts)
  })
})
