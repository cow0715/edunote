import type { VocabEntry } from '@/store/upload-store'

/**
 * 단어 시험 선택형([ 정답 / 오답 ]) 오답 고르기 + 출제 후보 텍스트 정리.
 * vocab-word-setup 에서 분리 — 순수 로직이라 여기서 테스트한다.
 */

export function normalizePromptCandidate(value: string | null | undefined) {
  let text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''

  text = text.split('※')[0] ?? text
  text = text
    .replace(/\((?:n|v|a|ad|adj|adv|prep|conj|phr|phrase)\.?\)/gi, ' ')
    .replace(/\b(?:n|v|a|ad|adj|adv|prep|conj|phr|phrase)\.\s*$/gi, ' ')
    .replace(/\[[^\]]*[가-힣][^\]]*\]/g, ' ')
    .replace(/\([^)]*[가-힣][^)]*\)/g, ' ')
    .replace(/^[=+@]+/, '')
    .replace(/[↔→←]/g, ' ')
    .replace(/["“”‘’]/g, ' ')
    .replace(/[^A-Za-z\s.'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text
}

/** 문자열 → 0~1 고정 해시 (단어마다 오답이 달라지되, 다시 렌더해도 같은 오답이 나오게) */
export function stableUnit(value: string) {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

export function normalizePos(value: string | null | undefined) {
  const v = (value ?? '').trim().toLowerCase()
  if (!v) return ''
  if (/^(v|vt|vi|verb|동)/.test(v)) return 'v'
  if (/^(n|noun|명)/.test(v)) return 'n'
  if (/^(adj|a\b|형)/.test(v)) return 'adj'
  if (/^(adv|ad\b|부)/.test(v)) return 'adv'
  return v
}

/**
 * 선택형 [ 정답 / 오답 ] 의 오답 후보 — AI 없이 같은 단어장에서 고른다.
 * 반의어일 필요는 없다. "비슷하게 생겼지만 다른 단어" 를 우선한다:
 *   같은 품사(문장에 넣어도 문법이 안 깨지게) > 첫 글자·길이·앞부분이 비슷 > 나머지.
 * 정답의 유의어·반의어·자기 자신은 제외 (유의어면 둘 다 정답이 되고, 반의어는 뜻으로 바로 갈리므로).
 * 파생어는 제외하지 않는다 — 같은 어근의 다른 형태(impressive/impress)는 실제 시험에 흔한
 * "어형 변화형" 오답이고, 문장에 넣으면 문법이 깨져 어형을 아는 학생만 걸러낼 수 있다.
 * 후보가 없을 때만 antonyms 필드 → null 순으로 폴백.
 */
export function choiceDistractor(word: VocabEntry, fallbackWords: VocabEntry[] = []): string | null {
  const self = word.english_word.trim().toLocaleLowerCase('en-US')
  const related = new Set([
    ...(word.synonyms ?? []), ...(word.antonyms ?? []),
    ...(word.variants ?? []).map((v) => v.word),
  ].map((s) => normalizePromptCandidate(s).toLocaleLowerCase('en-US')).filter(Boolean))

  // 파생어 = 어형 변화형(B) 오답 후보. 예문에 이미 있으면 답이 드러나므로 그때만 뺀다.
  const derivatives = (word.derivatives ?? '')
    .split(/[,/]+/)
    .map((s) => normalizePromptCandidate(s))
    .filter((s) => s && s.toLocaleLowerCase('en-US') !== self)
  const sentence = (word.example_sentence ?? '').toLocaleLowerCase('en-US')
  const pos = normalizePos(word.part_of_speech)

  // 후보마다 fallbackWords.find 로 품사를 다시 찾으면 O(N²) — 단어장 전체에 대해 부르면 N³ 이 된다
  const posByWord = new Map<string, string>()
  for (const other of fallbackWords) {
    const key = other.english_word.trim()
    if (!posByWord.has(key)) posByWord.set(key, normalizePos(other.part_of_speech))
  }

  const candidates = fallbackWords
    .map((other) => other.english_word.trim())
    .filter((w) => {
      const lower = w.toLocaleLowerCase('en-US')
      return lower && lower !== self && !w.includes('~') && !w.includes(' ') && !related.has(lower)
        && !sentence.includes(lower) // 예문 안에 이미 있는 단어면 답이 드러남
    })
    .map((w) => {
      const otherPos = posByWord.get(w) ?? ''
      let score = 0
      if (pos && otherPos) score += pos === otherPos ? 3 : -3
      if (w[0]?.toLowerCase() === self[0]) score += 1.5
      if (Math.abs(w.length - self.length) <= 2) score += 1
      let prefix = 0
      while (prefix < Math.min(w.length, self.length) && w[prefix].toLowerCase() === self[prefix]) prefix += 1
      if (prefix >= 2) score += 1
      // 동점 안에서 단어마다 다른 오답이 뽑히도록 고정 해시로 흔든다
      score += stableUnit(`${self}|${w}`) * 0.5
      return { w, score }
    })
    .sort((a, b) => b.score - a.score)

  // 어형 변화형(B): 예문에 없는 파생어. 단어별 고정 해시로 일부만 B 를 쓴다 —
  // 전부 B 로 가면 문맥을 안 봐도 어형만으로 풀려 예문 선택형의 취지가 죽는다.
  const usableDerivatives = derivatives.filter((d) => !sentence.includes(d.toLocaleLowerCase('en-US')))
  if (usableDerivatives.length > 0 && stableUnit(`deriv|${self}`) < 0.35) {
    return usableDerivatives[Math.floor(stableUnit(self) * usableDerivatives.length)]
  }

  if (candidates.length > 0) {
    // 상위 3개 중 하나 (단어별로 고정) — 매번 1등만 뽑히면 오답이 몇 개로 몰린다
    const top = candidates.slice(0, 3)
    return top[Math.floor(stableUnit(self) * top.length)].w
  }
  // 의미 대립형 후보가 없으면 파생어라도 쓴다 (아예 못 내는 것보단 낫다)
  if (usableDerivatives.length > 0) return usableDerivatives[0]
  const antonym = (word.antonyms ?? []).map((a) => normalizePromptCandidate(a)).find(Boolean)
  return antonym ?? null
}

/**
 * 선택형 오답 후보 — AI 가 예문과 함께 만들어 둔 것을 먼저 쓰고, 없으면 코드 규칙으로 폴백한다.
 *
 * 오답의 질이 곧 변별력이다. 품사가 안 맞으면 문장이 성립하지 않아
 * 학생이 뜻을 몰라도 소거로 맞히므로 오히려 너무 쉬운 문항이 된다.
 * 코드 규칙은 철자·품사 유사도만 보므로 "문맥상 그럴듯한 오답"까지는 못 만든다 —
 * 그건 예문을 만든 AI 가 더 잘 안다 (example_distractor).
 *
 * 둘 다 실패하면 null → 호출부는 그 단어로 선택형을 만들지 않는다.
 * 잘못된 문항을 내느니 안 내는 게 낫다.
 */
export function resolveChoiceDistractor(word: VocabEntry, fallbackWords: VocabEntry[] = []): string | null {
  const fromAi = normalizePromptCandidate(word.example_distractor)
  if (fromAi) {
    const self = word.english_word.trim().toLocaleLowerCase('en-US')
    const sentence = (word.example_sentence ?? '').toLocaleLowerCase('en-US')
    const lower = fromAi.toLocaleLowerCase('en-US')
    // 저장 시점에 걸렀지만, 예문이 나중에 바뀌었을 수 있어 여기서 한 번 더 본다
    if (lower !== self && !sentence.includes(lower)) return fromAi
  }
  return choiceDistractor(word, fallbackWords)
}

