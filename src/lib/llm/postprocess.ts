/**
 * 파싱 결과 공용 후처리 (순수 함수). 파이프라인 스펙의 postProcess 체인에 끼운다.
 * 도메인 타입을 모르도록 "필요한 필드만" 구조적으로 요구한다.
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

/** 파이프라인 postProcess 가 넘겨주는 skip 문맥의 부분집합 (구조적 요구만) */
export type SkipAwareContext = {
  skipped?: { chunkIndex: number }[]
  resetIndices?: Set<number>
}

/**
 * 번호 누락/중복 재배정: 청크를 합치면 모델이 번호를 빠뜨리거나 같은 번호를 두 번 낼 수 있다.
 * 비어 있거나 이미 쓰인 번호는 "아직 안 쓰인 가장 작은 번호"로 채운다. 순서는 보존.
 * 단, skip 으로 결손이 있으면(ctx.skipped) 가장 작은 번호 채우기가 **skip 된 문항의 번호를
 * 도용**할 수 있으므로, 그 경우엔 지금까지 쓴 최대 번호 다음으로만 채운다 (공백 보존).
 */
export function renumberDuplicateQuestions<T extends { question_number: unknown }>(
  items: T[],
  ctx?: SkipAwareContext,
): (T & { question_number: number })[] {
  const hasGaps = (ctx?.skipped?.length ?? 0) > 0
  // 결손이 있으면 재배정 번호는 리스트 전체 최대 번호 "다음"부터 — 결손 직후의 무번호 문항이
  // skip 된 문항의 번호(공백)를 도용하지 않도록
  let appendCursor = hasGaps
    ? Math.max(0, ...items.map((item) => coerceQuestionNumber(item.question_number) ?? 0))
    : 0
  const used = new Set<number>()
  let fallback = 1
  return items.map((item) => {
    let number = coerceQuestionNumber(item.question_number)
    if (!number || used.has(number)) {
      if (hasGaps) {
        appendCursor += 1
        number = appendCursor
      } else {
        while (used.has(fallback)) fallback += 1
        number = fallback
      }
    }
    used.add(number)
    if (number >= fallback) fallback = number + 1
    return { ...item, question_number: number }
  })
}

const REFERS_TO_PREVIOUS_PASSAGE = /윗\s*글|위\s*글|위의\s*글|앞\s*글|이\s*글의/

/**
 * 지문 공유 문항 전파: "[6~7] 다음 글을 읽고…" 세트가 청크 경계에 걸리면 뒤쪽 문항은 지문 없이 파싱된다.
 * 지문이 비어 있고 발문이 "윗글의…"처럼 앞 지문을 가리키면 직전 문항의 지문을 복사한다.
 * 발문 근거 없이 빈 지문을 채우진 않는다 (지문 없는 문장형 문항을 오염시키지 않도록).
 */
export function propagateSharedPassage<T extends { passage?: string | null; question_text?: string | null }>(
  items: T[],
  ctx?: SkipAwareContext,
): T[] {
  let lastPassage = ''
  return items.map((item, index) => {
    // skip 경계 직후 문항: 직전 지문이 "바로 앞 문항"의 것이라는 보장이 없다 — 엉뚱한 지문 전파 방지
    if (ctx?.resetIndices?.has(index)) lastPassage = ''
    const passage = (item.passage ?? '').trim()
    if (passage) {
      lastPassage = passage
      return item
    }
    const stem = item.question_text ?? ''
    if (lastPassage && REFERS_TO_PREVIOUS_PASSAGE.test(stem)) {
      return { ...item, passage: lastPassage }
    }
    return item
  })
}
