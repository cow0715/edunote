import type { BookExtraction, BookUnitManifest } from './types'

/** Typography variants carry the same text; words, punctuation and markup remain. */
export function normalizeBookText(value: string) {
  return value.replace(/[❶❷❸❹❺]/g, (s) => '①②③④⑤'['❶❷❸❹❺'.indexOf(s)])
    .normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
}

/** Compare rendered emphasis, so adjacent/nested equivalent markup is not an error. */
export function bookComparableText(value: string) {
  const text = normalizeBookText(value), bold = new Set<number>(), italic = new Set<number>()
  const boldPositions = [...text.matchAll(/\*\*/g)].map((m) => m.index!)
  for (let i = 0; i + 1 < boldPositions.length; i += 2) { bold.add(boldPositions[i]); bold.add(boldPositions[i + 1]) }
  for (const m of text.matchAll(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\s)\*(?!\*)/g)) { italic.add(m.index!); italic.add(m.index! + m[0].length - 1) }
  let isBold = false, isItalic = false, isUnderlined = false, pendingSpace = false
  const chars: [number, string][] = []
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && (text[i + 1] === '*' || text[i + 1] === '\\')) {
      if (pendingSpace && chars.length) chars.push([0, ' '])
      pendingSpace = false
      chars.push([(isBold ? 1 : 0) | (isItalic ? 2 : 0) | (isUnderlined ? 4 : 0), text[i + 1]])
      i += 2; continue
    }
    if (text.startsWith('<u>', i)) { isUnderlined = true; i += 3; continue }
    if (text.startsWith('</u>', i)) { isUnderlined = false; i += 4; continue }
    if (bold.has(i)) { isBold = !isBold; i += 2; continue }
    if (italic.has(i)) { isItalic = !isItalic; i++; continue }
    const character = String.fromCodePoint(text.codePointAt(i)!)
    i += character.length
    if (/\s/.test(character)) { pendingSpace = true; continue }
    if (pendingSpace && chars.length) chars.push([0, ' '])
    pendingSpace = false
    chars.push([(isBold ? 1 : 0) | (isItalic ? 2 : 0) | (isUnderlined ? 4 : 0), character])
  }
  return JSON.stringify(chars)
}

/** The printed question number is metadata, not part of the Korean question. */
export function normalizeBookStem(value: string, questionKey: string) {
  const number = Number(questionKey.split(':').at(-1))
  if (!Number.isInteger(number) || number < 1) return value
  return value.replace(new RegExp(`^\\s*${number}(?:[.)]\\s*|\\s+)(?=[가-힣])`), '')
}

export function bookVocabularyText(value: string) {
  // This template maps the square list glyph to "o" in its native PDF text.
  return value.replace(/^\s*(?:o|[□▪▫◦○●])\s+/gm, '')
}
export function normalizeBookExtraction(unit: BookUnitManifest, value: BookExtraction): BookExtraction {
  const sharedTypes: Record<string, string> = { order: 'long_order', title: 'long_title', content_match: 'long_content_match' }
  return { ...value, questions: value.questions.map((q) => ({ ...q, stem: normalizeBookStem(q.stem, q.key),
    question_type: unit.questions.length > 1 ? sharedTypes[q.question_type] ?? q.question_type : q.question_type })) }
}
