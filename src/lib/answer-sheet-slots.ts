export type SlotQuestion = {
  question_stem?: string | null
  question_text?: string | null
  passage?: string | null
  choices?: string[] | null
}

/** Only all-selection instructions expand to the option count, never the key count. */
export function answerSheetSlots(group: readonly SlotQuestion[]) {
  const source = group.map(q => [q.question_stem, q.question_text?.split('\n')[0]].filter(Boolean).join('\n')).join('\n')
  const counts: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 }
  const explicit = source.match(/(\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*개/)
  if (explicit) return { count: Math.max(1, Number(explicit[1]) || counts[explicit[1]] || 1), optional: false }

  const allSelection = /(?:모두|전부|있는\s*대로|빠짐없이)\s*(?:골라|고르|찾|선택)|(?:골라|고르|찾|선택)[^\n]*(?:모두|전부|빠짐없이)/.test(source)
  if (!allSelection) return { count: Math.max(1, group.length), optional: false }

  const text = group.map(q => [q.question_stem, q.question_text, q.passage].filter(Boolean).join('\n')).join('\n')
  // A passage reference such as ⓐ is not the option set when <보기> follows it.
  const options = text.split(/<\s*보기\s*>|〈보기〉|【보기】/).slice(1).join('\n') || text
  const digitMarks = new Set(options.match(/[①-⑳]/g) ?? [])
  const letterMarks = new Set(options.match(/[ⓐ-ⓩ]/g) ?? [])
  const plainLetters = new Set([...options.matchAll(/\(([A-Za-z])\)/g)].map(m => m[1].toLowerCase()))
  const circledRanges = [...options.matchAll(/([①-⑳ⓐ-ⓩ])\s*[~〜～–-]\s*([①-⑳ⓐ-ⓩ])/g)]
  const plainRanges = [...text.matchAll(/\(([A-Za-z])\)\s*[~〜～–-]\s*\(([A-Za-z])\)/g)]
  const rangeCount = Math.max(0,
    ...circledRanges.map(m => m[2].charCodeAt(0) - m[1].charCodeAt(0) + 1),
    ...plainRanges.map(m => m[2].toLowerCase().charCodeAt(0) - m[1].toLowerCase().charCodeAt(0) + 1))
  const choicesCount = Math.max(0, ...group.map(q => q.choices?.length ?? 0))
  // Legacy all-selection sources without recoverable markers use five options.
  return { count: Math.max(choicesCount, digitMarks.size, letterMarks.size, plainLetters.size, rangeCount) || 5, optional: true }
}
