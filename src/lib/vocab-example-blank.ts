// ── 예문 빈칸 출제 ──────────────────────────────────────────────────────────
// 예문 속 출제 단어(활용형 포함)를 빈칸 마커로 치환하고,
// 채점/정답지에서 원문과 빈칸 문장을 비교해 정답 표면형을 복원한다.

export const EXAMPLE_BLANK_MARKER = '_____'

/** 빈칸 마커(밑줄 3개 이상)를 기준으로 문장을 분리한다. 렌더링용. */
export function splitBlankedSentence(blanked: string): string[] {
  return blanked.split(/_{3,}/)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 단어의 흔한 굴절형 후보를 만든다 (3인칭 단수/과거/진행/복수). */
function inflectionCandidates(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set<string>([w])
  out.add(`${w}s`)
  out.add(`${w}es`)
  out.add(`${w}ed`)
  out.add(`${w}ing`)
  if (w.endsWith('e')) {
    const stem = w.slice(0, -1)
    out.add(`${w}d`)
    out.add(`${stem}ing`)
  }
  if (w.length > 2 && w.endsWith('y') && !'aeiou'.includes(w[w.length - 2])) {
    const stem = w.slice(0, -1)
    out.add(`${stem}ies`)
    out.add(`${stem}ied`)
  }
  // 단모음+단자음 자음 중복 (stop → stopped, run → running)
  if (/[aeiou][bcdfgklmnprstvz]$/.test(w) && !/[aeiou]{2}[bcdfgklmnprstvz]$/.test(w)) {
    const doubled = w + w[w.length - 1]
    out.add(`${doubled}ed`)
    out.add(`${doubled}ing`)
  }
  return [...out]
}

/** 구(phrase)면 첫 토큰만 굴절시킨 후보를 만든다 (give up → gave 는 불규칙이라 제외). */
function phraseCandidates(englishWord: string): string[] {
  const cleaned = englishWord.replace(/\s+/g, ' ').trim()
  const tokens = cleaned.split(' ')
  if (tokens.length === 1) return inflectionCandidates(cleaned)
  const rest = tokens.slice(1).join(' ')
  return inflectionCandidates(tokens[0]).map((head) => `${head} ${rest}`)
}

export type BlankedExample = {
  /** 출제 단어가 빈칸 처리된 문장. 매칭 실패 시 null */
  text: string | null
  /** 문장에 실제로 등장한 표면형 (학생이 써야 하는 답) */
  answer: string | null
  matched: boolean
}

/**
 * 예문에서 출제 단어를 찾아 빈칸 마커로 치환한다.
 * 활용형(-s/-ed/-ing 등)도 매칭하며, 정답은 문장에 등장한 표면형이다.
 */
export function blankExampleSentence(sentence: string | null | undefined, englishWord: string | null | undefined): BlankedExample {
  const source = (sentence ?? '').replace(/\s+/g, ' ').trim()
  const word = (englishWord ?? '').trim()
  if (!source || !word) return { text: null, answer: null, matched: false }
  // "take ~ into account" 같은 목적어 자리 표기는 문장 매칭이 불안정해 제외
  if (word.includes('~')) return { text: null, answer: null, matched: false }

  const candidates = phraseCandidates(word).sort((a, b) => b.length - a.length)
  for (const candidate of candidates) {
    const pattern = new RegExp(`(?<![A-Za-z])${escapeRegExp(candidate)}(?![A-Za-z])`, 'i')
    const match = pattern.exec(source)
    if (!match) continue
    const surface = match[0]
    const text = `${source.slice(0, match.index)}${EXAMPLE_BLANK_MARKER}${source.slice(match.index + surface.length)}`
    return { text, answer: surface, matched: true }
  }
  return { text: null, answer: null, matched: false }
}

/**
 * 예문에서 출제 단어를 찾아 괄호로 감싼다 (예문 뜻쓰기 유형, 영→한).
 * 예: "The room price includes breakfast." → "The room price (includes) breakfast."
 * 학생은 괄호 단어의 한글 뜻을 행 끝 밑줄에 쓴다.
 */
export function parenthesizeExampleSentence(sentence: string | null | undefined, englishWord: string | null | undefined): BlankedExample {
  const source = (sentence ?? '').replace(/\s+/g, ' ').trim()
  const blanked = blankExampleSentence(source, englishWord)
  if (!blanked.matched || !blanked.text || !blanked.answer) return { text: null, answer: null, matched: false }
  const text = blanked.text.replace(EXAMPLE_BLANK_MARKER, `(${blanked.answer})`)
  return { text, answer: blanked.answer, matched: true }
}

// ── 예문 선택형 (동그라미) ─────────────────────────────────────────────────
// 문장 속 출제 단어 자리에 [ 정답 / 오답 ] 두 후보를 넣고 학생이 맞는 쪽에 동그라미 친다.
// prompt_text 에는 "[ A / B ]" 가 박힌 문장만 저장하고 정답 위치는 저장하지 않으므로,
// 채점·정답지에서는 원문과 비교해 어느 쪽이 정답인지 역산한다.

export const CHOICE_OPEN = '[ '
export const CHOICE_CLOSE = ' ]'
export const CHOICE_SEP = ' / '

const CHOICE_PATTERN = /\[\s*([^\[\]/]+?)\s*\/\s*([^\[\]/]+?)\s*\]/

export type ChoiceExample = {
  /** "[ A / B ]" 가 박힌 문장. 실패 시 null */
  text: string | null
  /** 정답 표면형 (문장에 있던 단어) */
  answer: string | null
  /** 정답이 왼쪽(0)인지 오른쪽(1)인지 */
  answerIndex: 0 | 1 | null
  matched: boolean
}

/**
 * 예문의 출제 단어 자리에 [ 정답 / 오답 ] 후보를 넣는다.
 * @param distractor 오답 후보 (반의어 등). 정답과 같으면 실패
 * @param answerOnRight 정답을 오른쪽에 둘지 (호출부에서 랜덤 결정)
 */
export function choiceExampleSentence(
  sentence: string | null | undefined,
  englishWord: string | null | undefined,
  distractor: string | null | undefined,
  answerOnRight: boolean,
): ChoiceExample {
  const alt = (distractor ?? '').replace(/\s+/g, ' ').trim()
  const blanked = blankExampleSentence(sentence, englishWord)
  if (!blanked.matched || !blanked.text || !blanked.answer || !alt) {
    return { text: null, answer: null, answerIndex: null, matched: false }
  }
  if (alt.toLowerCase() === blanked.answer.toLowerCase()) {
    return { text: null, answer: null, answerIndex: null, matched: false }
  }
  const [left, right] = answerOnRight ? [alt, blanked.answer] : [blanked.answer, alt]
  const text = blanked.text.replace(EXAMPLE_BLANK_MARKER, `${CHOICE_OPEN}${left}${CHOICE_SEP}${right}${CHOICE_CLOSE}`)
  return { text, answer: blanked.answer, answerIndex: answerOnRight ? 1 : 0, matched: true }
}

/** "[ A / B ]" 문장에서 두 후보를 뽑는다. 없으면 null */
export function parseChoiceOptions(text: string | null | undefined): [string, string] | null {
  const match = CHOICE_PATTERN.exec(text ?? '')
  if (!match) return null
  return [match[1].trim(), match[2].trim()]
}

/** "[ A / B ]" 를 기준으로 문장을 앞/뒤로 분리한다 (렌더링용) */
export function splitChoiceSentence(text: string): { before: string; options: [string, string]; after: string } | null {
  const match = CHOICE_PATTERN.exec(text)
  if (!match) return null
  return {
    before: text.slice(0, match.index),
    options: [match[1].trim(), match[2].trim()],
    after: text.slice(match.index + match[0].length),
  }
}

/**
 * 원문 예문과 "[ A / B ]" 문장을 비교해 정답 인덱스를 복원한다.
 * 원문에 실제로 들어 있는 쪽이 정답이다.
 */
export function extractChoiceAnswerIndex(original: string | null | undefined, choiceText: string | null | undefined): 0 | 1 | null {
  const source = (original ?? '').replace(/\s+/g, ' ').trim()
  const target = (choiceText ?? '').replace(/\s+/g, ' ').trim()
  const parsed = splitChoiceSentence(target)
  if (!source || !parsed) return null
  const { before, options, after } = parsed
  for (const index of [0, 1] as const) {
    if (source === `${before}${options[index]}${after}`) return index
  }
  return null
}

/**
 * 원문 예문과 빈칸 문장을 비교해 빈칸 자리에 있던 표면형을 복원한다.
 * (정답지 표시·채점 기준용. prompt_text 에는 빈칸 문장만 저장되므로 역산이 필요하다.)
 */
export function extractBlankAnswer(original: string | null | undefined, blanked: string | null | undefined): string | null {
  const source = (original ?? '').replace(/\s+/g, ' ').trim()
  const target = (blanked ?? '').replace(/\s+/g, ' ').trim()
  if (!source || !target) return null
  const match = /_{3,}/.exec(target)
  if (!match) return null
  const prefix = target.slice(0, match.index)
  const suffix = target.slice(match.index + match[0].length)
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return null
  const answer = source.slice(prefix.length, source.length - suffix.length).trim()
  return answer || null
}
