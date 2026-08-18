// 단어시험 갤러리 + 채점 테스트 스크립트가 공유하는 샘플 데이터.
// (page.tsx 에서 export 하면 Next 페이지 export 규칙에 걸리므로 분리)

import { blankExampleSentence, choiceExampleSentence, parenthesizeExampleSentence } from '@/lib/vocab-example-blank'

export const MEANING_WORDS = [
  'necessary', 'abandon', 'perspective', 'treatment', 'obvious', 'demonstrate', 'inevitable', 'sustain',
  'considerable', 'phenomenon', 'restrict', 'evaluate', 'anticipate', 'contribute', 'deliberately', 'diminish',
  'emphasize', 'facilitate', 'genuine', 'hypothesis', 'implement', 'justify', 'legitimate', 'manipulate',
  'negotiate', 'objective', 'persist', 'reluctant', 'significant', 'temporary', 'undergo', 'vulnerable',
  'accumulate', 'boundary', 'compensate', 'derive', 'eliminate', 'fluctuate', 'grasp', 'incentive',
]

export const MEANING_KO: Record<string, string> = {
  necessary: '필수적인', abandon: '버리다', perspective: '관점', treatment: '치료', obvious: '분명한',
  demonstrate: '보여주다', inevitable: '불가피한', sustain: '유지하다', considerable: '상당한', phenomenon: '현상',
  restrict: '제한하다', evaluate: '평가하다', anticipate: '예상하다', contribute: '기여하다', deliberately: '고의로',
  diminish: '줄어들다', emphasize: '강조하다', facilitate: '촉진하다', genuine: '진짜의', hypothesis: '가설',
  implement: '시행하다', justify: '정당화하다', legitimate: '합법적인', manipulate: '조작하다',
}

export const EXAMPLE_SENTENCES: Array<{ word: string; sentence: string; translation: string; antonym: string; meaning: string; antonymMeaning: string }> = [
  { word: 'include', sentence: 'The room price includes breakfast.', translation: '객실 요금에는 아침 식사가 포함되어 있다.', antonym: 'exclude', meaning: '포함하다', antonymMeaning: '제외하다' },
  { word: 'provoke', sentence: "Don't provoke the angry dog.", translation: '화난 개를 자극하지 마라.', antonym: 'calm', meaning: '자극하다', antonymMeaning: '진정시키다' },
  { word: 'effect', sentence: 'The medicine had an immediate effect.', translation: '그 약은 즉각적인 효과가 있었다.', antonym: 'cause', meaning: '효과', antonymMeaning: '원인' },
  { word: 'reside', sentence: 'He resides with his parents in Busan.', translation: '그는 부산에서 부모님과 함께 산다.', antonym: 'depart', meaning: '거주하다', antonymMeaning: '떠나다' },
  { word: 'presume', sentence: 'A person is presumed innocent until proven guilty.', translation: '사람은 유죄가 입증되기 전까지 무죄로 추정된다.', antonym: 'doubt', meaning: '추정하다', antonymMeaning: '의심하다' },
  { word: 'suppress', sentence: 'The police quickly suppressed the riot.', translation: '경찰은 폭동을 신속히 진압했다.', antonym: 'encourage', meaning: '진압하다', antonymMeaning: '부추기다' },
  { word: 'abandon', sentence: 'The crew had to abandon the sinking ship immediately.', translation: '선원들은 가라앉는 배를 즉시 버려야 했다.', antonym: 'keep', meaning: '버리다', antonymMeaning: '지키다' },
  { word: 'sustain', sentence: 'Healthy soil is needed to sustain plant growth over time.', translation: '식물의 성장을 오랫동안 유지하려면 건강한 토양이 필요하다.', antonym: 'hinder', meaning: '유지하다', antonymMeaning: '방해하다' },
  { word: 'anticipate', sentence: 'We anticipated heavy traffic, so we left home early.', translation: '우리는 교통 체증을 예상해서 집을 일찍 나섰다.', antonym: 'ignore', meaning: '예상하다', antonymMeaning: '무시하다' },
  { word: 'emphasize', sentence: 'The coach emphasized the importance of regular practice.', translation: '코치는 규칙적인 연습의 중요성을 강조했다.', antonym: 'downplay', meaning: '강조하다', antonymMeaning: '축소하다' },
]

export type SampleItem = {
  id: string
  test_number: number
  prompt_source: string | null
  prompt_text: string | null
  display_word: string
  /** 채점 정답 (뜻쓰기·예문뜻: 한글 / 빈칸·선택: 영어) */
  answer: string
  meaning: string
  translation?: string
  choiceMeanings?: [string, string]
  /** 예문 원문 (채점 스크립트에서 정답 역산용) */
  example_sentence?: string
}

export function buildSampleItems(meaningCount: number, exampleMeaningCount: number, exampleBlankCount: number, exampleChoiceCount = 0): SampleItem[] {
  let number = 0
  const meaningItems: SampleItem[] = MEANING_WORDS.slice(0, meaningCount).map((word, index) => ({
    id: `m-${index}`,
    test_number: ++number,
    prompt_source: index % 4 === 3 ? 'synonym' : index % 7 === 5 ? 'antonym' : 'word',
    prompt_text: word,
    display_word: word,
    answer: MEANING_KO[word] ?? '뜻',
    meaning: MEANING_KO[word] ?? '뜻',
  }))
  const exampleMeaningItems: SampleItem[] = EXAMPLE_SENTENCES.slice(0, exampleMeaningCount).map((entry, index) => {
    const marked = parenthesizeExampleSentence(entry.sentence, entry.word)
    return {
      id: `em-${index}`, test_number: ++number, prompt_source: 'example_meaning',
      prompt_text: marked.text ?? entry.sentence, display_word: entry.word, answer: entry.meaning, meaning: entry.meaning, translation: entry.translation,
      example_sentence: entry.sentence,
    }
  })
  const exampleBlankItems: SampleItem[] = EXAMPLE_SENTENCES.slice(exampleMeaningCount, exampleMeaningCount + exampleBlankCount).map((entry, index) => {
    const blanked = blankExampleSentence(entry.sentence, entry.word)
    return {
      id: `eb-${index}`, test_number: ++number, prompt_source: 'example',
      prompt_text: blanked.text ?? entry.sentence, display_word: entry.word, answer: blanked.answer ?? entry.word, meaning: entry.meaning, translation: entry.translation,
      example_sentence: entry.sentence,
    }
  })
  const choiceStart = exampleMeaningCount + exampleBlankCount
  const exampleChoiceItems: SampleItem[] = EXAMPLE_SENTENCES.slice(choiceStart, choiceStart + exampleChoiceCount).map((entry, index) => {
    const answerOnRight = index % 2 === 1
    const choice = choiceExampleSentence(entry.sentence, entry.word, entry.antonym, answerOnRight)
    return {
      id: `ec-${index}`, test_number: ++number, prompt_source: 'example_choice',
      prompt_text: choice.text ?? entry.sentence, display_word: entry.word, answer: choice.answer ?? entry.word, meaning: entry.meaning, translation: entry.translation,
      choiceMeanings: answerOnRight ? [entry.antonymMeaning, entry.meaning] : [entry.meaning, entry.antonymMeaning],
      example_sentence: entry.sentence,
    }
  })
  return [...meaningItems, ...exampleMeaningItems, ...exampleBlankItems, ...exampleChoiceItems]
}

/**
 * 채점 테스트용 "학생이 쓴 답". 정답·오답·철자오류·미기재를 섞어 채점 분기를 전부 태운다.
 * 이 표가 곧 기대값 — scripts/test-vocab-grade-image.ts 가 채점 결과와 대조한다.
 * 프리셋 "24 + 뜻 4 + 빈칸 3 + 선택 3" 기준 (1~24 뜻쓰기, 25~28 예문뜻, 29~31 빈칸, 32~34 선택).
 */
export const SAMPLE_STUDENT_ANSWERS: Record<number, string> = {
  1: '필수적인', 2: '버리다', 3: '관점', 4: '치료', 5: '분명한', 6: '증명하다',
  7: '피할 수 없는', 8: '유지하다', 9: '상당한', 10: '현상', 11: '제한하다', 12: '평가하다',
  // 13~24 미기재
  // 예문뜻 (25~28): 정답, 오답, 정답, 미기재
  25: '포함하다', 26: '칭찬하다', 27: '효과',
  // 예문빈칸 (29~31): 정답, 철자 1자 오류(관용→정답), 어형 오류(과거형→오답; 문장 속 표면형은 원형 abandon)
  29: 'presumed', 30: 'suppresed', 31: 'abandoned',
  // 예문선택 (32~34): 정답, 오답, 정답
  32: 'sustain', 33: 'ignore', 34: 'emphasized',
}

/**
 * 기존 형식(뜻쓰기 40, 예문 없음) 시간 비교용 답안. 40개 중 34개 답, 6개 미기재 — 실제 학생 답안지와 비슷한 밀도.
 * 24번 이후 뜻은 MEANING_KO 에 없으니 그럴듯한 뜻을 직접 적음.
 */
export const LEGACY_STUDENT_ANSWERS: Record<number, string> = {
  1: '필수적인', 2: '버리다', 3: '관점', 4: '치료', 5: '분명한', 6: '증명하다',
  7: '피할 수 없는', 8: '유지하다', 9: '상당한', 10: '현상', 11: '제한하다', 12: '평가하다',
  13: '예상하다', 14: '기여하다', 15: '고의로', 16: '줄어들다', 17: '강조하다', 18: '촉진하다',
  19: '진짜의', 20: '가설', 21: '시행하다', 22: '정당화하다', 23: '합법적인', 24: '조작하다',
  25: '협상하다', 26: '목표', 27: '지속하다', 28: '꺼리는', 29: '중요한', 30: '일시적인',
  31: '겪다', 32: '취약한', 33: '축적하다', 34: '경계',
  // 35~40 미기재
}

/** 위 답안의 기대 채점 결과 (번호 → 정답 여부). 채점 스크립트 대조용 */
export const SAMPLE_EXPECTED: Record<number, boolean> = {
  1: true, 2: true, 3: true, 4: true, 5: true,
  6: true,   // 증명하다 — demonstrate 의 사전적 뜻이라 LLM 이 정답 처리해야 함
  7: true,   // 피할 수 없는 = 불가피한
  8: true, 9: true, 10: true, 11: true, 12: true,
  13: false, 14: false, 15: false, 16: false, 17: false, 18: false,
  19: false, 20: false, 21: false, 22: false, 23: false, 24: false,
  25: true, 26: false, 27: true, 28: false,
  29: true, 30: true, 31: false,
  32: true, 33: false, 34: true,
}
