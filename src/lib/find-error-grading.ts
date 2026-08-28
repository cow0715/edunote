/**
 * find_error(틀린 것 찾아 고치기) 채점 — 구조는 코드가, 의미만 AI가.
 *
 * 이 유형의 답은 "기호 + 고친 표현"의 복합 텍스트라 표기가 제각각이다:
 *   "4:satisfied" / "4: satisfied" / "④ were" / "X satisfying → satisfied" / ":Rarely did ..."
 * 예전엔 이걸 통째로 AI 채점에 맡겨서 콜론 뒤 공백 하나로 정오가 갈리거나(운영 실사례),
 * 정답키와 동일한 답이 오답 처리되는 일이 있었다. 이제:
 *   - 기호·고친 표현을 코드로 파싱해 확정 가능한 정오(기호+표현 일치, 기호 불일치)는 코드가 판정
 *   - 표현이 달라 의미 비교가 필요한 경우만 AI 로 넘긴다
 *   - 같은 문항의 소문항끼리는 순서 무관 집합 매칭 (학생의 첫 칸 답이 두 번째 정답과 매칭돼도 정답)
 *
 * grade route(채점 저장), questions route(정답 편집 재채점), week-reading-import(정답지 재채점)가 공유.
 */

export type FindErrorPart = {
  /** 정규화된 기호 ('a'~'e', '1'~'9'). 없으면 null */
  symbol: string | null
  /** 고친 표현 ("before → after" 는 after 쪽) */
  correction: string
}

const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩'
const CIRCLED_LOWER = 'ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙ'
const PAREN_LOWER = '⒜⒝⒞⒟⒠⒡⒢⒣⒤⒥'

/** 기호 표기 정규화: ①→'1', ⓒ→'c', (b)→'b', B→'b'. 기호가 아니면 null */
export function normalizeErrorSymbol(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().replace(/^[((]\s*|\s*[))]$/g, '')
  if (!value) return null

  if (value.length === 1) {
    const circled = CIRCLED_DIGITS.indexOf(value)
    if (circled >= 0) return String(circled + 1)
    const circledLower = CIRCLED_LOWER.indexOf(value)
    if (circledLower >= 0) return String.fromCharCode(97 + circledLower)
    const parenLower = PAREN_LOWER.indexOf(value)
    if (parenLower >= 0) return String.fromCharCode(97 + parenLower)
    if (/^[a-eA-E]$/.test(value)) return value.toLowerCase()
    if (/^[1-9]$/.test(value)) return value
  }
  return null
}

/** 고친 표현 비교용 정규화 — 대소문자·공백·끝 구두점·따옴표 차이를 흡수한다 */
export function normalizeCorrection(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim()
    .toLowerCase()
}

/** "before → after" / "before -> after" 는 after 쪽이 고친 표현 */
function afterArrow(text: string): string {
  const parts = text.split(/→|->/)
  return (parts.length > 1 ? parts[parts.length - 1] : text).trim()
}

/**
 * 정답키 파싱. 규격은 "기호:수정어" ("b:Rarely did ...", "4:satisfied")지만
 * 이탈 사례("different:similar" — 틀린단어:고친단어)도 고친 표현만은 살린다.
 */
export function parseFindErrorKey(text: string | null | undefined): FindErrorPart | null {
  const raw = (text ?? '').trim()
  if (!raw) return null
  const colon = raw.indexOf(':')
  if (colon > 0) {
    const symbol = normalizeErrorSymbol(raw.slice(0, colon))
    const correction = afterArrow(raw.slice(colon + 1).trim())
    if (correction) return { symbol, correction }
  }
  // 콜론 없는 이탈 형식 ("ⓒ ask → asked") — 학생 답 파서로 기호·표현을 건진다
  const parsed = parseFindErrorStudentAnswer(raw)
  return parsed.correction || parsed.symbol ? parsed : null
}

/** 파싱 저장용 정답키 정규형 — "④: were " → "4:were" */
export function normalizeFindErrorKeyText(text: string | null | undefined): string | null {
  const parsed = parseFindErrorKey(text)
  if (!parsed) return null
  return parsed.symbol ? `${parsed.symbol}:${parsed.correction}` : parsed.correction
}

/**
 * 학생 답 파싱. 손글씨 OCR·수기 입력의 온갖 변형을 흡수한다:
 *   "b: was" / "b) was" / "④ were" / "4:were" / "X was" / "X b: was" /
 *   ": was"(기호가 떨어져 나간 OCR) / "were → was" / "was"(고친 표현만)
 * 한 글자 알파벳 + 공백("a lot")은 표현의 일부일 수 있어 기호로 보지 않는다 —
 * 알파벳 기호는 : ) . 구분자가 있을 때만 인정한다.
 */
export function parseFindErrorStudentAnswer(text: string | null | undefined): FindErrorPart {
  let raw = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return { symbol: null, correction: '' }

  // O/X 교정형 습관으로 붙이는 선행 "X " 마커 제거 (X 뒤에 내용이 있을 때만)
  raw = raw.replace(/^[xX](?=[\s:].*\S)[\s:]*/, '')

  // 선행 기호: 원문자·괄호형은 그대로, 알파벳·숫자는 구분자([:).,] 또는 원문자엔 공백) 필요
  const match =
    /^([①②③④⑤⑥⑦⑧⑨⑩ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙ⒜⒝⒞⒟⒠])\s*[:).,]?\s*(.*)$/.exec(raw) ??
    /^[((]\s*([a-eA-E1-9])\s*[))]\s*[:.,]?\s*(.*)$/.exec(raw) ??
    /^([a-eA-E])\s*[:).]\s*(.*)$/.exec(raw) ??
    /^([1-9])\s*[:).]?\s+(.*)$/.exec(raw) ??
    /^([1-9])\s*[:).]\s*(.*)$/.exec(raw)

  if (match) {
    const symbol = normalizeErrorSymbol(match[1])
    if (symbol) return { symbol, correction: afterArrow(match[2].trim()) }
  }

  // OCR 이 기호만 떼고 콜론을 남긴 형태 ":Rarely did ..." → 기호 없음으로
  const orphanColon = /^[:.]\s*(.*)$/.exec(raw)
  if (orphanColon) return { symbol: null, correction: afterArrow(orphanColon[1].trim()) }

  // 기호 단독 ("4", "④", "b") — 수정 없이 기호만 쓴 답
  const solo = normalizeErrorSymbol(raw)
  if (solo) return { symbol: solo, correction: '' }

  return { symbol: null, correction: afterArrow(raw) }
}

// ── 문항 단위 집합 매칭 ──────────────────────────────────────────────────

export type FindErrorKeyRow = {
  /** exam_question row 식별자 (id 등 호출부가 원하는 키) */
  id: string
  correctAnswerText: string | null
}

export type FindErrorVerdict =
  | 'correct'   // 코드 확정 정답 (기호·표현 모두 일치)
  | 'wrong'     // 코드 확정 오답 (기호가 정답 기호가 아님 / 기호만 쓰고 수정 없음 / 미입력)
  | 'ai'        // 의미 비교 필요 → AI 채점으로

export type FindErrorAssignment = {
  id: string
  /** 이 정답 행에 배정된 학생 답 (원문 그대로, 재배열만 함) */
  text: string
  verdict: FindErrorVerdict
}

/**
 * 학생이 쓴 답들을 문항의 정답 행들에 순서 무관으로 배정하고 정오를 판정한다.
 * texts 는 UI/OCR 슬롯 순서의 학생 답 (정답 행과 같은 개수, 빈 칸 포함).
 * 반환은 정답 행마다 하나 — 매칭된 답이 그 행으로 이동한다.
 */
export function assignFindErrorAnswers(
  keyRows: FindErrorKeyRow[],
  texts: string[],
): FindErrorAssignment[] {
  const keys = keyRows.map((row) => ({ row, part: parseFindErrorKey(row.correctAnswerText) }))
  const keySymbols = new Set(keys.map((k) => k.part?.symbol).filter((s): s is string => !!s))

  type Entry = { text: string; part: FindErrorPart }
  const entries: Entry[] = texts
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, part: parseFindErrorStudentAnswer(text) }))

  const assigned = new Map<string, { text: string; verdict: FindErrorVerdict }>()
  const usedEntries = new Set<Entry>()

  // 1차: 기호가 정답 기호와 일치하는 답 → 그 정답 행에 배정
  for (const entry of entries) {
    if (!entry.part.symbol) continue
    const key = keys.find((k) => !assigned.has(k.row.id) && k.part?.symbol === entry.part.symbol)
    if (!key?.part) continue
    usedEntries.add(entry)
    const verdict: FindErrorVerdict = !entry.part.correction
      ? 'wrong' // 기호만 쓰고 수정 없음 → 오답 (채점 규칙 (E))
      : normalizeCorrection(entry.part.correction) === normalizeCorrection(key.part.correction)
        ? 'correct'
        : 'ai' // 기호는 맞았고 표현이 다름 — 문장 전체를 쓴 경우 등 의미 비교 필요
    assigned.set(key.row.id, { text: entry.text, verdict })
  }

  // 2차: 기호 없는 답 중 고친 표현이 정답과 일치하는 것 → 정답 (기호 없으면 의미 매칭 규칙)
  for (const entry of entries) {
    if (usedEntries.has(entry) || entry.part.symbol || !entry.part.correction) continue
    const key = keys.find(
      (k) => !assigned.has(k.row.id) && k.part
        && normalizeCorrection(entry.part.correction) === normalizeCorrection(k.part.correction),
    )
    if (!key) continue
    usedEntries.add(entry)
    assigned.set(key.row.id, { text: entry.text, verdict: 'correct' })
  }

  // 3차: 남은 답을 남은 행에 순서대로 배정
  const leftoverKeys = keys.filter((k) => !assigned.has(k.row.id))
  const leftoverEntries = entries.filter((e) => !usedEntries.has(e))
  leftoverKeys.forEach((key, index) => {
    const entry = leftoverEntries[index]
    if (!entry) return
    // 기호를 썼는데 어떤 정답 기호와도 다름 → 확정 오답 (기호 다르면 무조건 오답 규칙)
    // 단, 정답키에 기호가 하나도 없으면 기호로 판정할 수 없으니 AI 로
    const verdict: FindErrorVerdict =
      entry.part.symbol && keySymbols.size > 0 && !keySymbols.has(entry.part.symbol) ? 'wrong' : 'ai'
    assigned.set(key.row.id, { text: entry.text, verdict })
  })

  // 행보다 답이 많으면 마지막 행 텍스트에 이어 붙인다 (조용히 버리지 않는다)
  const overflow = leftoverEntries.slice(leftoverKeys.length)
  if (overflow.length > 0 && keys.length > 0) {
    const lastId = keys[keys.length - 1].row.id
    const last = assigned.get(lastId)
    const extraText = overflow.map((e) => e.text).join(' / ')
    if (last) assigned.set(lastId, { ...last, text: `${last.text} / ${extraText}` })
    else assigned.set(lastId, { text: extraText, verdict: 'ai' })
  }

  return keyRows.map((row) => {
    const result = assigned.get(row.id)
    if (result) return { id: row.id, ...result }
    return { id: row.id, text: '', verdict: 'wrong' } // 미입력
  })
}

/**
 * 행 하나짜리 재채점 (정답 편집·정답지 재적용 경로) — 문항의 전체 정답키와 대조한다.
 * 확정 못하면 'ai' 를 돌려주고, 호출부가 needs_review 로 표시한다.
 */
export function gradeFindErrorRow(
  keyTexts: (string | null)[],
  studentText: string | null | undefined,
): FindErrorVerdict {
  const keys = keyTexts.map((k) => parseFindErrorKey(k)).filter((k): k is FindErrorPart => !!k)
  if (keys.length === 0) return 'ai'
  const entry = parseFindErrorStudentAnswer(studentText)
  if (!entry.correction && !entry.symbol) return 'wrong' // 빈 답

  const keySymbols = new Set(keys.map((k) => k.symbol).filter((s): s is string => !!s))
  if (entry.symbol) {
    if (keySymbols.size > 0 && !keySymbols.has(entry.symbol)) return 'wrong'
    const key = keys.find((k) => k.symbol === entry.symbol)
    if (key) {
      if (!entry.correction) return 'wrong'
      return normalizeCorrection(entry.correction) === normalizeCorrection(key.correction) ? 'correct' : 'ai'
    }
    return 'ai'
  }
  const matched = keys.some((k) => normalizeCorrection(entry.correction) === normalizeCorrection(k.correction))
  return matched ? 'correct' : 'ai'
}
