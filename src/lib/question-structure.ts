export type StructuredQuestionParts = {
  question_stem?: string | null
  passage?: string | null
  choices?: string[] | null
  question_text?: string | null
}

export function normalizeQuestionChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((choice) => (typeof choice === 'string' ? choice.trim() : ''))
    .filter(Boolean)
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
    if (lastLines.length > 0 && lastLines.every((line) => /^\d+\.\s+/.test(line))) {
      choices.push(...lastLines.map((line) => line.replace(/^\d+\.\s+/, '').trim()).filter(Boolean))
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
  if (choices.length > 0) {
    blocks.push(choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n'))
  }

  return blocks.length > 0 ? blocks.join('\n\n') : null
}

export function buildQuestionDisplayText(question: StructuredQuestionParts): string {
  return buildQuestionTextFromParts(getStructuredQuestionParts(question)) ?? question.question_text?.trim() ?? ''
}
