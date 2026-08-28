import { describe, expect, it } from 'vitest'
import type { VocabEntry } from '@/store/upload-store'
import { choiceDistractor, normalizePos, resolveChoiceDistractor } from '@/lib/vocab-choice-distractor'

// 선택형 [ 정답 / 오답 ] 의 오답은 AI 없이 같은 단어장에서 고른다.
// 반의어일 필요 없음 — "비슷하게 생겼지만 다른 단어" 우선, 유의어/파생어/예문 속 단어는 제외.

function w(partial: Partial<VocabEntry> & { english_word: string }): VocabEntry {
  return {
    number: 0, correct_answer: '', synonyms: [], antonyms: [], derivatives: null,
    part_of_speech: null, passage_label: null, example_sentence: null, example_translation: null,
    ...partial,
  } as VocabEntry
}

const LIST: VocabEntry[] = [
  w({ number: 1, english_word: 'participate', part_of_speech: 'v' }),
  w({ number: 2, english_word: 'unique', part_of_speech: 'adj' }),
  w({ number: 3, english_word: 'exhibit', part_of_speech: 'v', example_sentence: 'The museum will exhibit the rare paintings next month.', synonyms: ['display', 'show'] }),
  w({ number: 4, english_word: 'display', part_of_speech: 'v' }),
  w({ number: 5, english_word: 'exhaust', part_of_speech: 'v' }),
  w({ number: 6, english_word: 'museum', part_of_speech: 'n' }),
  w({ number: 7, english_word: 'expand', part_of_speech: 'v' }),
  w({ number: 8, english_word: 'give up', part_of_speech: 'v' }),
]

describe('choiceDistractor', () => {
  it('같은 품사 + 비슷한 생김새를 우선한다 (exhibit → exhaust/expand 같은 e-로 시작하는 동사)', () => {
    const picked = choiceDistractor(LIST[2], LIST)
    expect(['exhaust', 'expand']).toContain(picked)
  })

  it('유의어·자기 자신·예문 안에 있는 단어·띄어쓰기 단어는 오답 후보에서 뺀다', () => {
    // 100번 뽑아도(다른 단어 기준으로) display(유의어)·museum(예문에 등장)·give up(띄어쓰기) 는 안 나온다
    for (const target of LIST) {
      const picked = choiceDistractor(target, LIST)
      if (target.english_word === 'exhibit') {
        expect(picked).not.toBe('display')
        expect(picked).not.toBe('museum')
      }
      expect(picked).not.toBe(target.english_word)
      expect(picked).not.toBe('give up')
    }
  })

  it('단어마다 고정 — 다시 불러도 같은 오답 (미리보기와 실제 출제가 일치)', () => {
    expect(choiceDistractor(LIST[2], LIST)).toBe(choiceDistractor(LIST[2], LIST))
    expect(choiceDistractor(LIST[0], LIST)).toBe(choiceDistractor(LIST[0], LIST))
  })

  it('오답이 한 단어로 몰리지 않는다 — 예전엔 폴백이 항상 단어장 1번(participate)이었다', () => {
    const picks = LIST.filter((x) => x.english_word !== 'participate').map((x) => choiceDistractor(x, LIST))
    expect(new Set(picks).size).toBeGreaterThan(1)
    expect(picks.filter((p) => p === 'participate').length).toBeLessThan(picks.length)
  })

  it('품사가 다르면 뒤로 밀린다 (unique 형용사 → 동사·명사보다 형용사가 없으니 그래도 뭔가는 고름)', () => {
    const picked = choiceDistractor(LIST[1], LIST)
    expect(picked).toBeTruthy()
    expect(picked).not.toBe('unique')
  })

  it('단어장 후보가 없으면 antonyms 필드로 폴백, 그것도 없으면 null', () => {
    const lonely = w({ english_word: 'happy', antonyms: ['sad'] })
    expect(choiceDistractor(lonely, [lonely])).toBe('sad')
    expect(choiceDistractor(w({ english_word: 'happy' }), [])).toBeNull()
  })
})

// 오답의 질이 곧 변별력이다. 품사가 안 맞으면 문장이 성립하지 않아
// 학생이 뜻을 몰라도 소거로 맞힌다 (운영 실사례: "Let's [ take a break / impressive ]").
// 문맥상 그럴듯한 오답은 예문을 만든 AI 가 더 잘 알므로 그 후보를 먼저 쓴다.
describe('resolveChoiceDistractor — AI 후보 우선', () => {
  it('AI 가 만들어 둔 후보가 있으면 그것을 쓴다', () => {
    const word = w({
      english_word: 'take a break',
      example_sentence: "Let's take a break and grab some coffee.",
      example_distractor: 'make a call',
    })
    expect(resolveChoiceDistractor(word, LIST)).toBe('make a call')
  })

  it('AI 후보가 정답 자신이면 버리고 코드 규칙으로 폴백', () => {
    const word = w({ english_word: 'unique', part_of_speech: 'adj', example_distractor: 'unique' })
    expect(resolveChoiceDistractor(word, LIST)).not.toBe('unique')
  })

  it('AI 후보가 예문에 이미 있으면 버린다 — 답이 드러난다', () => {
    const word = w({
      english_word: 'exhibit',
      example_sentence: 'The museum will exhibit the rare paintings next month.',
      example_distractor: 'paintings',
    })
    expect(resolveChoiceDistractor(word, LIST)).not.toBe('paintings')
  })

  it('AI 후보가 없으면 기존 코드 규칙 결과와 같다', () => {
    const word = w({ english_word: 'unique', part_of_speech: 'adj' })
    expect(resolveChoiceDistractor(word, LIST)).toBe(choiceDistractor(word, LIST))
  })

  it('AI 후보도 코드 후보도 없으면 null — 호출부가 선택형을 만들지 않는다', () => {
    const lonely = w({ english_word: 'happy' })
    expect(resolveChoiceDistractor(lonely, [lonely])).toBeNull()
  })
})

describe('normalizePos', () => {
  it('영문 약어·한글 품사를 같은 키로 맞춘다', () => {
    expect(normalizePos('v.')).toBe('v')
    expect(normalizePos('verb')).toBe('v')
    expect(normalizePos('동사')).toBe('v')
    expect(normalizePos('n')).toBe('n')
    expect(normalizePos('명사')).toBe('n')
    expect(normalizePos('adj.')).toBe('adj')
    expect(normalizePos('형용사')).toBe('adj')
    expect(normalizePos('adv')).toBe('adv')
    expect(normalizePos(null)).toBe('')
  })
})
