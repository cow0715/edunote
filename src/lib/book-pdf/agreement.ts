import type { BookExtraction } from './types'
import { bookComparableText, normalizeBookStem } from './text'

// Ignore PDF line wrapping, but preserve words, punctuation, paragraph labels,
// option order and underline markup. A token bag cannot prove these match.
function normalized(value: string) { return bookComparableText(value) }

export function compareBookExtractions(a: BookExtraction, b: BookExtraction) {
  const differences: string[] = []
  for (const key of ['passage', 'translation', 'vocabulary'] as const) {
    if (normalized(a[key]) !== normalized(b[key])) differences.push(key)
  }
  const left = new Map(a.questions.map((q) => [q.key, q])), right = new Map(b.questions.map((q) => [q.key, q]))
  if (left.size !== a.questions.length || right.size !== b.questions.length || left.size !== right.size) differences.push('question_inventory')
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const x = left.get(key), y = right.get(key)
    if (!x || !y) { differences.push(`${key}:question`); continue }
    for (const field of ['stem', 'intent', 'solution', 'question_type'] as const) {
      const leftValue = field === 'stem' ? normalizeBookStem(x[field], key) : x[field]
      const rightValue = field === 'stem' ? normalizeBookStem(y[field], key) : y[field]
      if (normalized(leftValue) !== normalized(rightValue)) differences.push(`${key}:${field}`)
    }
    if (x.answer !== y.answer) differences.push(`${key}:answer`)
    if (x.choices.length !== y.choices.length || x.choices.some((c, i) => normalized(c) !== normalized(y.choices[i] ?? ''))) differences.push(`${key}:choices`)
  }
  return differences
}
