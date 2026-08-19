/**
 * 객관식 정오 판정 — 서버(grade route)와 UI(채점 정오표)가 같은 규칙을 쓰도록 한 곳에 둔다.
 *
 * - 정답 후보 = correct_answer + extra_correct_answers (0 이하는 무시)
 * - all_correct 문항은 답이 있기만 하면 정답
 * - 답이 없으면 undefined (미입력)
 */
export type ObjectiveKey = {
  correct_answer: number | null | undefined
  extra_correct_answers?: number[] | null
  all_correct?: boolean | null
}

export function acceptedObjectiveAnswers(q: ObjectiveKey): Set<number> {
  return new Set(
    [q.correct_answer ?? 0, ...(q.extra_correct_answers ?? [])]
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0),
  )
}

export function gradeObjective(q: ObjectiveKey, studentAnswer: number | null | undefined): boolean | undefined {
  if (studentAnswer === null || studentAnswer === undefined) return undefined
  if (q.all_correct) return true
  return acceptedObjectiveAnswers(q).has(studentAnswer)
}
