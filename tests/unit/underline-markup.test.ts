import { describe, it, expect } from 'vitest'
import { applyUnderlineMarkupToParts, applyUnderlineMarkupToQuestionText } from '../../src/lib/week-reading-import'

// 해설지형(단일 question_text)으로 저장된 "밑줄 친 낱말" 문항의 밑줄 자동 부착.
// 공유 페이지 오답노트에 밑줄이 안 보이던 버그의 backfill/안전망 로직.

const VOCAB_USAGE = [
  '다음 글의 밑줄 친 낱말의 쓰임이 적절하지 않은 것은?',
  '',
  'The scientist made a ① direct observation of the phenomenon. Her findings were ② consistent with earlier studies, and the results ③ varied little between trials.',
  '',
  '① direct',
  '② consistent',
  '③ varied',
].join('\n')

describe('applyUnderlineMarkupToQuestionText', () => {
  it('선지 목록이 있는 어휘형: 지문 속 ① 단어에 <u> 를 붙인다', () => {
    const result = applyUnderlineMarkupToQuestionText(VOCAB_USAGE)
    expect(result).toContain('① <u>direct</u> observation')
    expect(result).toContain('② <u>consistent</u> with')
  })

  it('선지 목록 줄 자체에는 밑줄을 붙이지 않는다', () => {
    const result = applyUnderlineMarkupToQuestionText(VOCAB_USAGE)
    const choiceLines = result.split('\n').filter((l) => /^①|^②|^③/.test(l.trim()))
    expect(choiceLines).toEqual(['① direct', '② consistent', '③ varied'])
  })

  it('멱등: 두 번 적용해도 결과가 같다', () => {
    const once = applyUnderlineMarkupToQuestionText(VOCAB_USAGE)
    expect(applyUnderlineMarkupToQuestionText(once)).toBe(once)
  })

  it('밑줄 유형이 아니면 그대로 둔다', () => {
    const text = '다음 글의 제목으로 가장 적절한 것은?\nSome passage.\n① title one\n② title two'
    expect(applyUnderlineMarkupToQuestionText(text)).toBe(text)
  })

  it('알려진 한계: 지문 내 ① 마커만 있고 선지 목록이 없는 어법형은 복원하지 않는다 (문서화)', () => {
    // 밑줄이 어디서 끝나는지(have? have adapted?) 정보가 저장돼 있지 않아 추측하면 오히려 위험.
    const grammarInline = [
      '다음 글의 밑줄 친 부분 중 어법상 틀린 것은?',
      '',
      'Organisms ① have adapted in extraordinary ways. The traits ② which they display allow them to survive.',
    ].join('\n')
    expect(applyUnderlineMarkupToQuestionText(grammarInline)).toBe(grammarInline)
  })
})

// 해설지형도 조각 필드(question_stem/passage)를 채우게 되면서(2026-09-01 프롬프트 변경),
// 화면이 조각을 우선해 그린다. question_text 에만 밑줄을 붙이면 화면에서 밑줄이 사라진다.
describe('applyUnderlineMarkupToParts', () => {
  const PASSAGE = 'The scientist made a ① direct observation. Her findings were ② consistent with earlier studies.'
  const base = {
    question_stem: '다음 글의 밑줄 친 낱말의 쓰임이 적절하지 않은 것은?',
    passage: PASSAGE,
    choices: ['direct', 'consistent'],
  }

  it('passage 속 선지 단어에 <u> 를 붙인다', () => {
    const result = applyUnderlineMarkupToParts(base)
    expect(result.passage).toContain('① <u>direct</u> observation')
    expect(result.passage).toContain('② <u>consistent</u> with')
  })

  it('멱등: 두 번 적용해도 결과가 같다', () => {
    const once = applyUnderlineMarkupToParts(base)
    expect(applyUnderlineMarkupToParts(once)).toEqual(once)
  })

  it('밑줄 유형이 아니면 그대로 둔다', () => {
    const other = { ...base, question_stem: '다음 글의 제목으로 가장 적절한 것은?' }
    expect(applyUnderlineMarkupToParts(other)).toEqual(other)
  })

  it('조각이 비어 있으면(예전 데이터) 손대지 않는다', () => {
    const legacy = { question_text: '다음 글의 밑줄 친 낱말의 쓰임이 적절하지 않은 것은?', question_stem: null, passage: null }
    expect(applyUnderlineMarkupToParts(legacy)).toEqual(legacy)
  })

  it('선지가 1개 이하면 어느 번호에 붙일지 알 수 없어 건드리지 않는다', () => {
    const single = { ...base, choices: ['direct'] }
    expect(applyUnderlineMarkupToParts(single)).toEqual(single)
  })
})
