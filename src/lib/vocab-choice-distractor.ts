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
 * 정답의 유의어·파생어·반의어·자기 자신은 제외 (유의어면 둘 다 정답이 되고, 반의어는 뜻으로 바로 갈리므로).
 * 후보가 없을 때만 antonyms 필드 → null 순으로 폴백.
 */
export function choiceDistractor(word: VocabEntry, fallbackWords: VocabEntry[] = []): string | null {
  const self = word.english_word.trim().toLocaleLowerCase('en-US')
  const related = new Set([
    ...(word.synonyms ?? []), ...(word.antonyms ?? []),
    ...(word.variants ?? []).map((v) => v.word),
    ...(word.derivatives ?? '').split(/[,/]+/),
  ].map((s) => normalizePromptCandidate(s).toLocaleLowerCase('en-US')).filter(Boolean))
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

  if (candidates.length > 0) {
    // 상위 3개 중 하나 (단어별로 고정) — 매번 1등만 뽑히면 오답이 몇 개로 몰린다
    const top = candidates.slice(0, 3)
    return top[Math.floor(stableUnit(self) * top.length)].w
  }
  const antonym = (word.antonyms ?? []).map((a) => normalizePromptCandidate(a)).find(Boolean)
  return antonym ?? null
}

