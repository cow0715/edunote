import { describe, expect, it } from 'vitest'
import {
  blankExampleSentence,
  choiceExampleSentence,
  extractBlankAnswer,
  extractChoiceAnswerIndex,
  parenthesizeExampleSentence,
  parseChoiceOptions,
  splitBlankedSentence,
  splitChoiceSentence,
  EXAMPLE_BLANK_MARKER,
} from '@/lib/vocab-example-blank'

describe('blankExampleSentence', () => {
  it('원형 그대로 등장하면 빈칸 처리한다', () => {
    const result = blankExampleSentence('I like you very much.', 'like')
    expect(result.matched).toBe(true)
    expect(result.text).toBe(`I ${EXAMPLE_BLANK_MARKER} you very much.`)
    expect(result.answer).toBe('like')
  })

  it('3인칭 단수형을 매칭한다', () => {
    const result = blankExampleSentence('She abandons the plan.', 'abandon')
    expect(result.text).toBe(`She ${EXAMPLE_BLANK_MARKER} the plan.`)
    expect(result.answer).toBe('abandons')
  })

  it('과거형(-ed)을 매칭한다', () => {
    const result = blankExampleSentence('They abandoned the ship.', 'abandon')
    expect(result.answer).toBe('abandoned')
  })

  it('e로 끝나는 단어의 -ing형을 매칭한다 (e 탈락)', () => {
    const result = blankExampleSentence('He is making a cake.', 'make')
    expect(result.answer).toBe('making')
  })

  it('y → ies 변화를 매칭한다', () => {
    const result = blankExampleSentence('He carries a heavy bag.', 'carry')
    expect(result.answer).toBe('carries')
  })

  it('자음 중복(-pped)을 매칭한다', () => {
    const result = blankExampleSentence('The car stopped suddenly.', 'stop')
    expect(result.answer).toBe('stopped')
  })

  it('문장 첫 단어(대문자)도 매칭하고 표면형을 유지한다', () => {
    const result = blankExampleSentence('Necessary changes were made.', 'necessary')
    expect(result.text).toBe(`${EXAMPLE_BLANK_MARKER} changes were made.`)
    expect(result.answer).toBe('Necessary')
  })

  it('다른 단어의 일부는 매칭하지 않는다 (like ↔ likely)', () => {
    const result = blankExampleSentence('It is likely to rain.', 'like')
    expect(result.matched).toBe(false)
  })

  it('구(phrase)를 매칭한다', () => {
    const result = blankExampleSentence('Do not give up your dream.', 'give up')
    expect(result.text).toBe(`Do not ${EXAMPLE_BLANK_MARKER} your dream.`)
    expect(result.answer).toBe('give up')
  })

  it('구의 첫 토큰 굴절형을 매칭한다', () => {
    const result = blankExampleSentence('He gives up too easily.', 'give up')
    expect(result.answer).toBe('gives up')
  })

  it('~ 표기가 있는 구는 출제 대상에서 제외한다', () => {
    const result = blankExampleSentence('You should take it into account.', 'take ~ into account')
    expect(result.matched).toBe(false)
  })

  it('예문에 단어가 없으면 매칭 실패를 반환한다', () => {
    const result = blankExampleSentence('This sentence has nothing.', 'abandon')
    expect(result).toEqual({ text: null, answer: null, matched: false })
  })

  it('예문이 비어 있으면 매칭 실패를 반환한다', () => {
    expect(blankExampleSentence(null, 'abandon').matched).toBe(false)
    expect(blankExampleSentence('   ', 'abandon').matched).toBe(false)
  })
})

describe('parenthesizeExampleSentence', () => {
  it('출제 단어를 괄호로 감싼다', () => {
    const result = parenthesizeExampleSentence('The room price includes breakfast.', 'include')
    expect(result.matched).toBe(true)
    expect(result.text).toBe('The room price (includes) breakfast.')
    expect(result.answer).toBe('includes')
  })

  it('활용형 표면형을 그대로 괄호에 넣는다', () => {
    const result = parenthesizeExampleSentence('They abandoned the ship.', 'abandon')
    expect(result.text).toBe('They (abandoned) the ship.')
  })

  it('구(phrase)도 괄호로 감싼다', () => {
    const result = parenthesizeExampleSentence('He gives up too easily.', 'give up')
    expect(result.text).toBe('He (gives up) too easily.')
  })

  it('예문에 단어가 없으면 매칭 실패를 반환한다', () => {
    expect(parenthesizeExampleSentence('Nothing here.', 'abandon').matched).toBe(false)
  })
})

describe('choiceExampleSentence', () => {
  it('정답을 왼쪽에 두고 [ A / B ] 를 만든다', () => {
    const result = choiceExampleSentence('The room price includes breakfast.', 'include', 'exclude', false)
    expect(result.matched).toBe(true)
    expect(result.text).toBe('The room price [ includes / exclude ] breakfast.')
    expect(result.answer).toBe('includes')
    expect(result.answerIndex).toBe(0)
  })

  it('정답을 오른쪽에 둘 수 있다', () => {
    const result = choiceExampleSentence('The room price includes breakfast.', 'include', 'exclude', true)
    expect(result.text).toBe('The room price [ exclude / includes ] breakfast.')
    expect(result.answerIndex).toBe(1)
  })

  it('오답 후보가 없거나 정답과 같으면 실패', () => {
    expect(choiceExampleSentence('I like you.', 'like', '', false).matched).toBe(false)
    expect(choiceExampleSentence('I like you.', 'like', 'Like', false).matched).toBe(false)
  })

  it('예문에 단어가 없으면 실패', () => {
    expect(choiceExampleSentence('Nothing here.', 'like', 'hate', false).matched).toBe(false)
  })
})

describe('parseChoiceOptions / splitChoiceSentence', () => {
  it('두 후보를 뽑는다', () => {
    expect(parseChoiceOptions('I [ like / hate ] you.')).toEqual(['like', 'hate'])
    expect(parseChoiceOptions('I like you.')).toBeNull()
  })

  it('앞/후보/뒤로 분리한다', () => {
    expect(splitChoiceSentence('I [ like / hate ] you.')).toEqual({ before: 'I ', options: ['like', 'hate'], after: ' you.' })
  })
})

describe('extractChoiceAnswerIndex', () => {
  it('원문에 있는 쪽을 정답 인덱스로 복원한다', () => {
    expect(extractChoiceAnswerIndex('I like you.', 'I [ like / hate ] you.')).toBe(0)
    expect(extractChoiceAnswerIndex('I like you.', 'I [ hate / like ] you.')).toBe(1)
  })

  it('둘 다 원문과 안 맞으면 null', () => {
    expect(extractChoiceAnswerIndex('I love you.', 'I [ like / hate ] you.')).toBeNull()
  })
})

describe('extractBlankAnswer', () => {
  it('원문과 빈칸 문장을 비교해 표면형을 복원한다', () => {
    expect(extractBlankAnswer('I like you very much.', `I ${EXAMPLE_BLANK_MARKER} you very much.`)).toBe('like')
  })

  it('굴절형 표면형을 그대로 복원한다', () => {
    expect(extractBlankAnswer('They abandoned the ship.', 'They _____ the ship.')).toBe('abandoned')
  })

  it('밑줄 개수가 달라도 (3개 이상) 복원한다', () => {
    expect(extractBlankAnswer('I like you.', 'I ___ you.')).toBe('like')
  })

  it('빈칸 문장이 원문과 어긋나면 null', () => {
    expect(extractBlankAnswer('I like you.', 'We _____ you.')).toBeNull()
  })

  it('빈칸 마커가 없으면 null', () => {
    expect(extractBlankAnswer('I like you.', 'I like you.')).toBeNull()
  })
})

describe('splitBlankedSentence', () => {
  it('마커를 기준으로 앞뒤 텍스트를 분리한다', () => {
    expect(splitBlankedSentence(`I ${EXAMPLE_BLANK_MARKER} you.`)).toEqual(['I ', ' you.'])
  })

  it('마커가 없으면 전체 문장 하나를 반환한다', () => {
    expect(splitBlankedSentence('I like you.')).toEqual(['I like you.'])
  })
})
