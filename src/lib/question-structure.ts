export type StructuredQuestionParts = {
  question_stem?: string | null
  passage?: string | null
  choices?: string[] | null
  question_text?: string | null
}

export const CIRCLED_CHOICE_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

export function normalizeQuestionChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((choice) => (typeof choice === 'string' ? choice.trim() : ''))
    .filter(Boolean)
}

export function hasChoiceMarker(value: string): boolean {
  return /^(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s+/.test(value.trim())
}

/** "①" / "(③)" 처럼 기호만 있는 선지 — 문장 삽입 위치처럼 고를 대상이 지문 안에 있어 텍스트가 없다 */
export function isBareMarkerChoice(value: string): boolean {
  return /^\(?\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*\)?$/.test(value.trim())
}

/**
 * 선지 내용이 이미 지문 안에 있는가 — 밑줄 어법·어휘, 무관한 문장, 문장 삽입 유형.
 *
 * 이런 문항은 시험지에 별도 선지 목록이 없다. 파서는 choices 를 항상 채우지만(다시풀기가
 * 번호로 고르려면 필요하다), 화면·인쇄용으로 question_text 를 조립할 때 목록을 또 붙이면
 * 시험지에 없던 다섯 줄이 생긴다. 판정은 데이터로만 한다: 선지가 전부 기호뿐이거나,
 * 각 선지 텍스트가 지문에 그대로 들어 있으면 "지문 안에 있다" 로 본다.
 */
export function choicesAreInline(passage: string | null | undefined, choices: string[]): boolean {
  if (choices.length === 0) return false
  if (choices.every(isBareMarkerChoice)) return true
  // 마크업과 공백 차이는 무시한다 — 무관한 문장 유형은 선지가 지문 문장 전체라 줄바꿈이 다르게 올 수 있다
  const collapse = (text: string) => text.replace(/<\/?u>|\*\*/g, '').replace(/\s+/g, ' ').trim()
  const body = collapse(passage ?? '')
  if (!body) return false
  return choices.every((choice) => {
    const text = collapse(choice.replace(/^\s*(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/, ''))
    return text.length > 0 && body.includes(text)
  })
}

export function ensureChoiceMarker(choice: string, index: number): string {
  const trimmed = choice.trim()
  if (hasChoiceMarker(trimmed)) return trimmed
  return `${CIRCLED_CHOICE_NUMBERS[index] ?? `${index + 1}.`} ${trimmed}`
}

export function splitStoredQuestionText(raw: string | null | undefined): {
  questionStem: string
  passage: string
  choices: string[]
} {
  const blocks = (raw ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const choices: string[] = []
  if (blocks.length > 0) {
    const lastLines = blocks[blocks.length - 1].split('\n').map((line) => line.trim()).filter(Boolean)
    if (lastLines.length > 0 && lastLines.every((line) => /^(?:\d+\.|[①②③④⑤⑥⑦⑧⑨⑩])\s+/.test(line))) {
      choices.push(...lastLines.map((line) => line.replace(/^(?:\d+\.|[①②③④⑤⑥⑦⑧⑨⑩])\s+/, '').trim()).filter(Boolean))
      blocks.pop()
    }
  }

  const questionStem = blocks.shift() ?? ''
  const passage = blocks.join('\n\n')
  return { questionStem, passage, choices }
}

export function getStructuredQuestionParts(question: StructuredQuestionParts): {
  questionStem: string
  passage: string
  choices: string[]
} {
  const structuredChoices = normalizeQuestionChoices(question.choices)
  const hasStructured =
    !!question.question_stem?.trim() ||
    !!question.passage?.trim() ||
    structuredChoices.length > 0

  if (hasStructured) {
    return {
      questionStem: question.question_stem?.trim() ?? '',
      passage: question.passage?.trim() ?? '',
      choices: structuredChoices,
    }
  }

  return splitStoredQuestionText(question.question_text)
}

export function buildQuestionTextFromParts(parts: {
  questionStem?: string | null
  passage?: string | null
  choices?: string[] | null
}): string | null {
  const blocks: string[] = []
  const questionStem = parts.questionStem?.trim()
  const passage = parts.passage?.trim()
  const choices = normalizeQuestionChoices(parts.choices)

  if (questionStem) blocks.push(questionStem)
  if (passage) blocks.push(passage)
  // 선지가 지문 안에 있는 유형(밑줄·무관한 문장·삽입)은 목록을 붙이지 않는다 — 시험지에 없는 줄이다
  if (choices.length > 0 && !choicesAreInline(passage, choices)) {
    blocks.push(choices.map((choice, index) => ensureChoiceMarker(choice, index)).join('\n'))
  }

  return blocks.length > 0 ? blocks.join('\n\n') : null
}

export function buildQuestionDisplayText(question: StructuredQuestionParts): string {
  return buildQuestionTextFromParts(getStructuredQuestionParts(question)) ?? question.question_text?.trim() ?? ''
}
