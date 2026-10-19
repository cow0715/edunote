import { bookExtractionSchema, type BookExtraction, type BookUnitManifest, type BookValidation } from './types'
import type { SourceMap } from './source-map'
import { normalizeBookExtraction } from './text'
import { validateBookUnit } from './validation'

/** Bind only printed source identities. Array order alone is never identity. */
export function bindBookMapping(unit: BookUnitManifest, input: SourceMap): SourceMap {
  if (input.groups.length !== 1) throw Error('대상 지문 묶음은 하나여야 합니다.')
  const mapping = structuredClone(input), expected = new Set(unit.questions.map((q) => q.key))
  const actual = mapping.groups[0].questions.map((q) => q.id)
  if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some((id) => !expected.has(id))) throw Error('원문 문항 식별자와 매핑 문항이 일치하지 않습니다.')
  mapping.groups[0].questions.sort((a, b) => unit.questions.findIndex((q) => q.key === a.id) - unit.questions.findIndex((q) => q.key === b.id))
  return mapping
}

/** Native coverage/ownership is enforced before audit. Image comparison is the
 * text authority after OCR repair, so corrupt native strings cannot veto it.
 * Printed identity/answer conflicts still hold publication for boundary review. */
export function validateNativeBookUnit(unit: BookUnitManifest, input: unknown): BookValidation {
  const result = bookExtractionSchema.safeParse(input), errors: string[] = []
  if (!result.success) return { errors: ['추출 결과의 필수 항목 또는 형식이 올바르지 않습니다.'], warnings: [], english_coverage: 0, translation_coverage: 0 }
  const value = result.data, expected = new Set(unit.questions.map((q) => q.key))
  if (value.questions.length !== expected.size || new Set(value.questions.map((q) => q.key)).size !== expected.size
    || value.questions.some((q) => !expected.has(q.key))) errors.push('원문 문항 목록과 추출 문항 목록이 일치하지 않습니다.')
  if (!unit.visual_required && !value.passage.trim()) errors.push('지문이 없습니다.')
  if (!value.translation.trim()) errors.push('해석이 없습니다.')
  for (const ref of unit.questions) {
    const q = value.questions.find((q) => q.key === ref.key)
    if (!q) continue
    if (q.answer !== ref.printed_answer) errors.push(`${ref.label}: 경계 조사 정답과 이미지 판독 정답이 다릅니다.`)
    if (!q.stem.trim() || q.choices.length !== 5 || q.choices.some((c) => !c.trim()) || !q.solution.trim()) errors.push(`${ref.label}: 발문·선지·해설이 빠졌습니다.`)
  }
  const diagnostic = validateBookUnit(unit, value)
  return { errors, warnings: [...(unit.visual_required ? ['도표는 원본 PDF 페이지로 보존합니다.'] : []),
    ...(diagnostic.errors.length ? ['PDF 텍스트와 이미지 판독의 표현 차이는 원본 이미지 검증 결과를 기준으로 처리했습니다.'] : [])],
    english_coverage: diagnostic.english_coverage, translation_coverage: diagnostic.translation_coverage }
}

export function nativeBookExtraction(unit: BookUnitManifest, extraction: BookExtraction) {
  return normalizeBookExtraction(unit, bookExtractionSchema.parse(extraction))
}
