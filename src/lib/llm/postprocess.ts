/**
 * 파싱 결과 공용 후처리 (순수 함수).
 * renumberDuplicateQuestions·propagateSharedPassage 는 삭제됨 — pages 청킹(경계에서 번호·지문이
 * 끊기는 문제)의 보정 장치였는데, 출력 범위 분할(llm/ranged.ts) 전환으로 문제 자체가 사라졌다 (2026-08-27).
 */

export function coerceQuestionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const match = value.match(/\d+/g)
    if (!match?.length) return null
    const parsed = Number.parseInt(match[match.length - 1], 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
