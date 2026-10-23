/** Internal question_number remains a grading key. These fields describe the PDF. */
export type QuestionPresentation = {
  question_number: number
  sub_label?: string | null
  source_section?: 'general' | 'written' | null
  source_question_number?: number | null
  display_order?: number | null
  passage_group?: string | null
  shared_passage?: string | null
}

export function questionLabel(q: QuestionPresentation, withSubLabel = true): string {
  const number = q.source_question_number ?? q.question_number
  const parent = q.source_section === 'written' ? `서답형 ${number}` : `${number}번`
  return `${parent}${withSubLabel && q.sub_label ? ` (${q.sub_label})` : ''}`
}

export function sortQuestionsByPdf<T extends QuestionPresentation>(questions: readonly T[]): T[] {
  return [...questions].sort((a, b) => (a.display_order ?? a.question_number) - (b.display_order ?? b.question_number) ||
    a.question_number - b.question_number || (a.sub_label ?? '').localeCompare(b.sub_label ?? ''))
}

export function groupQuestionParents<T extends QuestionPresentation>(questions: readonly T[]) {
  const parents = new Map<number, T[]>()
  for (const q of sortQuestionsByPdf(questions)) {
    const group = parents.get(q.question_number) ?? []
    group.push(q)
    parents.set(q.question_number, group)
  }
  return [...parents].map(([qNum, group]) => ({ qNum, group }))
}

/** Consecutive passage runs preserve PDF order even for a non-consecutive reference. */
export function groupQuestionPassages<T extends QuestionPresentation>(questions: readonly T[]) {
  const runs: { key: string; passage: string | null; questions: T[] }[] = []
  for (const q of sortQuestionsByPdf(questions)) {
    const key = q.passage_group ? `passage:${q.passage_group}` : `question:${q.question_number}`
    const previous = runs.at(-1)
    if (previous?.key === key) previous.questions.push(q)
    else runs.push({ key, passage: q.shared_passage ?? null, questions: [q] })
  }
  return runs
}

/** Remove only the exact shared source, retaining per-question examples and choices. */
export function withoutSharedPassage(text: string, passage: string | null): string {
  if (!passage?.trim()) return text
  const pattern = passage.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  return text.replace(new RegExp(pattern, 'u'), '').replace(/\n{3,}/g, '\n\n').trim()
}
