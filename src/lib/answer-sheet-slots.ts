/** Layout depends only on the printed instruction/options, never the answer key. */
export type SlotQuestion = {
  question_stem?: string | null
  question_text?: string | null
  passage?: string | null
  choices?: string[] | null
}

export function answerSheetSlots(group: readonly SlotQuestion[]) {
  const source = group.map(q => [q.question_stem, q.question_text?.split('\n')[0]].filter(Boolean).join('\n')).join('\n')
  const counts: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6 }
  const explicit = source.match(/(\d+|한|두|세|네|다섯|여섯)\s*개(?:를|의|만)?\s*(?:찾|고르|골라|선택|쓰|적|바르게)/)
  if (explicit) return { count: Math.max(1, Number(explicit[1]) || counts[explicit[1]]), optional: false }

  const text = group.map(q => [q.question_stem, q.question_text, q.passage].filter(Boolean).join('\n')).join('\n')
  const digitMarks = new Set(text.match(/[①-⑳]/g) ?? [])
  const letterMarks = new Set(text.match(/[ⓐ-ⓩ]/g) ?? [])
  const ranges = [...text.matchAll(/([①-⑳ⓐ-ⓩ])\s*[~〜～–-]\s*([①-⑳ⓐ-ⓩ])/g)]
  const rangeCount = Math.max(0, ...ranges.map(m => m[2].charCodeAt(0) - m[1].charCodeAt(0) + 1))
  const choicesCount = Math.max(0, ...group.map(q => q.choices?.length ?? 0))
  // Legacy sources without recoverable option markers use the standard five options.
  return { count: Math.max(choicesCount, digitMarks.size, letterMarks.size, rangeCount) || 5, optional: true }
}

export const OPTIONAL_SLOT_GUIDANCE = '필요한 칸만 작성하세요. 남은 칸은 비워 두세요.'
