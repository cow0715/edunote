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

/**
 * 무효/전원정답 플래그를 고칠 때 최종 상태를 정한다.
 *
 * 문항 편집은 바뀐 플래그만 보낸다. 안 보낸 쪽은 **DB 현재값을 유지**해야 하는데,
 * 예전에는 false 로 떨어졌다 — all_correct 인 문항의 무효만 해제하면
 * "전원정답도 해제" 로 오해해 학생들이 오답으로 찍혔다 (운영 7번 문항이 이 상태였다).
 *
 * 우선순위는 무효 > 전원정답 > 정답키 재채점. 무효면 채점 대상이 아니기 때문이다.
 */
export type FlagVerdict = 'void' | 'all_correct' | 'regrade'

export function resolveQuestionFlags(
  requested: { is_void?: boolean; all_correct?: boolean },
  current: { is_void?: boolean | null; all_correct?: boolean | null },
): { isVoid: boolean; allCorrect: boolean; verdict: FlagVerdict } {
  const isVoid = requested.is_void ?? current.is_void ?? false
  const allCorrect = requested.all_correct ?? current.all_correct ?? false
  return {
    isVoid,
    allCorrect,
    verdict: isVoid ? 'void' : allCorrect ? 'all_correct' : 'regrade',
  }
}
