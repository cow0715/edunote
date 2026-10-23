type ReadingKey = {
  question_number: number
  sub_label: string | null
  question_style: string
  correct_answer: number
  correct_answer_text: string | null
  source_section?: string | null
  source_question_number?: number | null
}

/** Existing grades may be retained only when every original grading key survives.
 * This is deliberately stricter than a normal import: no missing/retyped/rekeyed parents. */
export function assertPreservableReadingReparse(existing: ReadingKey[], parsed: ReadingKey[]): void {
  const key = (q: ReadingKey) => `${q.question_number}|${q.sub_label ?? ''}`
  const next = new Map(parsed.map((q) => [key(q), q]))
  for (const previous of existing) {
    const question = next.get(key(previous))
    const text = (value: string | null) => (value ?? '').replace(/\s+/g, '')
    if (!question || question.question_style !== previous.question_style ||
        question.correct_answer !== previous.correct_answer ||
        text(question.correct_answer_text) !== text(previous.correct_answer_text) ||
        (question.source_section ?? 'general') !== (previous.source_section ?? 'general') ||
        (question.source_question_number ?? question.question_number) !== (previous.source_question_number ?? previous.question_number)) {
      throw new Error(`기존 답안 보존 검사 실패: ${previous.question_number}${previous.sub_label ?? ''}. 기존 문항과 답안을 변경하지 않았습니다.`)
    }
  }
}
