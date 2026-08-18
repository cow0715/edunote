// ── 예문 빈칸(영→영) · 예문 선택 채점 ─────────────────────────────────────
// LLM 없이 결정적으로 판정한다.
//
// 빈칸 정책 (2026-08-18 사용자 결정):
// - 어형은 엄격: 문장 속 표면형(abandoned)을 써야 정답. 원형(abandon)·다른 굴절형(abandons)은 오답.
//   → 이 시험은 "문맥에 맞는 형태까지 아는가"를 본다.
// - 철자는 관용: 편집거리 1(한 글자 누락/추가/치환, 인접 두 글자 뒤바뀜)까지 정답.
//   단, 그 오타가 다른 굴절형과 같아지면(abandons↔abandoned 같은 경우) 어형 오류로 보고 오답.
//   단, 4글자 이하 짧은 단어는 한 글자가 단어의 1/4이라 관용 없음.
// - 대소문자·앞뒤 공백·구두점은 무시.
//
// 선택 정책: 후보 두 개 중 고르는 문항이라 정확 비교 (관용 없음).

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 단어의 "실제 존재할 법한" 굴절형 후보.
 * vocab-example-blank 의 매칭용 후보보다 엄격하다 — 여기서는 어형 오류 판정에 쓰므로
 * 영어에 없는 형태(stop → stoped)를 굴절형으로 넣으면 진짜 오타를 어형 오류로 오판한다.
 *   - 단모음+단자음으로 끝나면 자음 중복형만 (stopped / stopping), 비중복형은 제외
 *   - e 로 끝나면 e 탈락형만 (making), 'makeing' 제외
 *   - 자음+y 로 끝나면 ies/ied 만, 'carrys' 제외
 */
function inflections(word: string): Set<string> {
  const w = word
  const out = new Set<string>([w])
  const doublesFinal = /[aeiou][bcdfgklmnprstvz]$/.test(w) && !/[aeiou]{2}[bcdfgklmnprstvz]$/.test(w) && w.length >= 3
  const consonantY = w.length > 2 && w.endsWith('y') && !'aeiou'.includes(w[w.length - 2])

  if (w.endsWith('e')) {
    out.add(`${w}s`)
    out.add(`${w}d`)
    out.add(`${w.slice(0, -1)}ing`)
  } else if (consonantY) {
    out.add(`${w.slice(0, -1)}ies`)
    out.add(`${w.slice(0, -1)}ied`)
    out.add(`${w}ing`)
  } else if (doublesFinal) {
    const doubled = w + w[w.length - 1]
    out.add(`${w}s`)
    out.add(`${doubled}ed`)
    out.add(`${doubled}ing`)
  } else {
    out.add(`${w}s`)
    out.add(`${w}es`)
    out.add(`${w}ed`)
    out.add(`${w}ing`)
  }
  return out
}

/** 표면형에서 원형 후보를 역산한다 (abandoned → abandon, making → make, carries → carry ...) */
function baseCandidates(surface: string): string[] {
  const out = new Set<string>([surface])
  const strip = (suffix: string) => surface.endsWith(suffix) && surface.length > suffix.length + 1
    ? surface.slice(0, -suffix.length)
    : null

  for (const suffix of ['ing', 'ed', 'es', 's', 'd']) {
    const stem = strip(suffix)
    if (!stem) continue
    out.add(stem)
    if (suffix === 'ing' || suffix === 'ed') {
      out.add(`${stem}e`)
      if (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2]) {
        out.add(stem.slice(0, -1))
      }
    }
    if ((suffix === 'es' || suffix === 'ed') && stem.endsWith('i')) {
      out.add(`${stem.slice(0, -1)}y`)
    }
  }
  return [...out]
}

/** 정답 표면형과 같은 어족의 다른 굴절형 집합 (정답 자신은 제외) */
function siblingForms(surface: string): Set<string> {
  const out = new Set<string>()
  for (const base of baseCandidates(surface)) {
    for (const form of inflections(base)) {
      if (form !== surface) out.add(form)
    }
  }
  return out
}

/**
 * typed 가 정답 surface 의 "진짜" 다른 어형인지.
 * sibling 집합에 있고, 그 sibling 이 정답 원형 후보의 굴절형으로서 실제 존재할 법한 형태여야 한다.
 * 가짜 원형(자음 중복 해제 등)에서 나온 형태는 정답과 거리 1이라 오타와 구별이 안 되므로 sibling 으로 보지 않는다.
 * → 규칙: 어형이 다르면 어미가 달라 보통 거리 2 이상. 거리 1인 sibling 은 실제로는 오타.
 *   예외적으로 거리 1이면서 진짜 어형 차이인 경우(includes↔included, make↔made)는
 *   "정답 원형 자체의 굴절형" 목록에서만 인정한다.
 */
function isRealSibling(surface: string, typed: string): boolean {
  if (!siblingForms(surface).has(typed)) return false
  // 정답 원형 후보 중 "surface 를 실제로 만들어내는" 원형만 신뢰
  const trustedBases = baseCandidates(surface).filter((base) => inflections(base).has(surface))
  for (const base of trustedBases) {
    if (inflections(base).has(typed)) return true
  }
  return false
}

/** Damerau-Levenshtein 거리가 1 이하인지 (한 글자 누락/추가/치환 또는 인접 뒤바뀜) */
export function isWithinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  if (la === lb) {
    // 치환 1개 또는 인접 전치 1개
    const diffs: number[] = []
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) diffs.push(i)
    if (diffs.length === 1) return true
    if (diffs.length === 2 && diffs[1] === diffs[0] + 1) {
      return a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]]
    }
    return false
  }
  // 길이 차 1: 긴 쪽에서 한 글자 빼면 같은가
  const [short, long] = la < lb ? [a, b] : [b, a]
  let i = 0
  while (i < short.length && short[i] === long[i]) i++
  return short.slice(i) === long.slice(i + 1)
}

const MIN_LENGTH_FOR_TYPO_TOLERANCE = 5

/**
 * 예문 빈칸 채점. 정답 표면형과 어형까지 일치해야 하며, 철자 오차 1글자는 관용한다.
 * 정답이 구(give up)면 토큰 수가 같아야 하고 각 토큰을 위 규칙으로 비교한다.
 */
export function gradeBlankAnswer(studentAnswer: string | null | undefined, correctAnswer: string | null | undefined): boolean {
  const student = normalize(studentAnswer)
  const correct = normalize(correctAnswer)
  if (!student || !correct) return false
  if (student === correct) return true

  const correctTokens = correct.split(' ')
  const studentTokens = student.split(' ')
  if (correctTokens.length !== studentTokens.length) return false

  return correctTokens.every((token, index) => {
    const typed = studentTokens[index]
    if (typed === token) return true
    if (token.length < MIN_LENGTH_FOR_TYPO_TOLERANCE) return false
    if (!isWithinOneEdit(typed, token)) return false
    // 오타처럼 보여도 "진짜" 다른 굴절형과 같으면 어형 오류로 본다.
    // 단, 굴절형 후보 생성이 가짜 원형(suppressed→suppres)을 만들어 정답과 거리 1인 형태(suppresed)를
    // sibling 으로 잡는 경우가 있다. 어형이 다르면 보통 어미가 통째로 달라 거리 2 이상이므로,
    // 정답과 거리 1 이내인 sibling 은 어형 차이가 아니라 오타로 취급한다.
    return !isRealSibling(token, typed)
  })
}

/**
 * 예문 선택형 채점: 학생이 표시한 후보 단어가 정답 후보와 같은지 (철자 그대로 비교, 관용 없음).
 */
export function gradeChoiceAnswer(studentAnswer: string | null | undefined, correctAnswer: string | null | undefined): boolean {
  const student = normalize(studentAnswer)
  const correct = normalize(correctAnswer)
  if (!student || !correct) return false
  return student === correct
}
