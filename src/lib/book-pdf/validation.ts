import { bookExtractionSchema, type BookExtraction, type BookUnderline, type BookUnitManifest, type BookValidation } from './types'
import { nativeBookQuestionText } from './inventory'
import { bookVocabularyText, normalizeBookStem, normalizeBookText } from './text'

function plain(text: string) { return normalizeBookText(text.replace(/<[^>]*>/g, '').replace(/\*+/g, '')).toLowerCase() }
/** Multiset recall catches missing repeated text too; it is a signal, not semantic proof. */
function recall(source: string[], output: string[]) {
  if (!source.length) return 1
  const available = new Map<string, number>()
  output.forEach((t) => available.set(t, (available.get(t) ?? 0) + 1))
  let found = 0
  source.forEach((t) => { const n = available.get(t) ?? 0; if (n) { found++; available.set(t, n - 1) } })
  return found / source.length
}
function english(text: string) { return plain(text).match(/[a-z]+(?:['’][a-z]+)*/g) ?? [] }
function compact(text: string) { return plain(text).replace(/[^가-힣a-z0-9]/g, '') }
function grams(text: string) { const s = compact(text); return Array.from({ length: Math.max(0, s.length - 2) }, (_, i) => s.slice(i, i + 3)) }
function textCoverage(source: string, output: string) {
  const s = compact(source)
  if (s.length < 3) return !s || compact(output).includes(s) ? 1 : 0
  return recall(grams(source), grams(output))
}
function missingEmphasis(fields: string[], hints: BookUnderline[], expression: RegExp) {
  const available = fields.flatMap((field) => [...field.matchAll(expression)].map((m) => plain(m[1]).replace(/\s+/g, ' ').trim()))
  for (const hint of hints) {
    const needle = plain(hint.text).replace(/\s+/g, ' ').trim()
    const word = /^[a-z]+$/.test(needle) ? new RegExp(`(?<![a-z])${needle}(?![a-z])`) : null
    const index = available.findIndex((text) => word ? word.test(text) : compact(text).includes(compact(needle)))
    if (index < 0) return true
    available[index] = word ? available[index].replace(word, '|') : compact(available[index]).replace(compact(needle), '|')
  }
  return false
}
function rightBody(text: string) {
  // A standalone number immediately before the next answer is a question label.
  return text.replace(/\n[ \t]*\d{1,3}\.?[ \t]*(?=\n[ \t]*\[정답\])/g, '')
}
function rightSections(text: string, labels: string[]) {
  return [...rightBody(text).matchAll(/\[(정답|소재|해석|해설|풀이|어휘)\]([\s\S]*?)(?=\[(?:정답|소재|해석|해설|풀이|어휘)\]|$)/g)]
    .filter((m) => labels.includes(m[1])).map((m) => m[2].trim()).join('\n')
}

export function validateBookUnit(unit: BookUnitManifest, input: unknown, strict = false): BookValidation {
  const parsed = bookExtractionSchema.safeParse(input)
  if (!parsed.success) return { errors: ['추출 결과의 필수 항목 또는 형식이 올바르지 않습니다.'], warnings: [], english_coverage: 0, translation_coverage: 0 }
  const value = parsed.data
  const errors: string[] = [], warnings: string[] = []
  const answerBlocks = rightBody(unit.right_text).split(/\[정답\]/).slice(1)
  const commonTopic = rightSections(unit.right_text, ['소재'])
  const keys = value.questions.map((q) => q.key)
  if (keys.length !== unit.questions.length || new Set(keys).size !== keys.length || unit.questions.some((q) => !keys.includes(q.key))) errors.push('원문 문항 목록과 추출 문항 목록이 일치하지 않습니다.')
  for (const ref of unit.questions) {
    const q = value.questions.find((x) => x.key === ref.key)
    if (!q) continue
    if (q.answer !== ref.printed_answer) errors.push(`${ref.label}: 원문 정답 ${ref.printed_answer ?? '미확인'}과 추출 정답 ${q.answer}가 다릅니다.`)
    if (!q.stem.trim() || q.choices.length !== 5 || q.choices.some((c) => !c.trim())) errors.push(`${ref.label}: 발문 또는 5개 선지가 빠졌습니다.`)
    if (!q.solution.trim()) errors.push(`${ref.label}: 해설이 없습니다.`)
    if (strict) {
      const native = normalizeBookStem(nativeBookQuestionText(unit, ref.key), ref.key), local = compact(native)
      const extractedStem = normalizeBookStem(q.stem, ref.key)
      const stem = native.trim().match(/^([\s\S]{1,600}?[?？])/)?.[1]
      // This format prints the Korean question immediately after its label.
      // Checking the complete leading stem catches missing negation too.
      if (stem && (stem.match(/[가-힣]/g)?.length ?? 0) > stem.length / 2 && !compact(extractedStem).includes(compact(stem))) errors.push(`${ref.label}: 자동 검증에서 원문 발문의 누락·변경을 발견했습니다.`)
      if (extractedStem.split('\n').some((line) => /[가-힣]/.test(line) && compact(line).length >= 3 && !local.includes(compact(line)))) errors.push(`${ref.label}: 발문이 해당 문항의 원문 범위와 다릅니다.`)
      if (answerBlocks.length === unit.questions.length) {
        const block = answerBlocks[unit.questions.indexOf(ref)]
        const solution = rightSections(block, ['해설', '풀이'])
        const topic = rightSections(block, ['소재']) || commonTopic
        if (solution && textCoverage(solution, q.solution) < 1) errors.push(`${ref.label}: 해당 문항의 원문 해설이 누락됐거나 다른 문항과 연결됐습니다.`)
        if (topic && textCoverage(topic, q.intent) < 1) errors.push(`${ref.label}: 원문 소재가 해당 문항에 연결되지 않았습니다.`)
      }
      let after = 0
      for (const choice of q.choices) {
        const content = compact(choice), position = local.indexOf(content, after)
        if (!content || position < 0) { errors.push(`${ref.label}: 선지 내용·순서가 해당 문항의 원문과 다릅니다.`); break }
        after = position + content.length
      }
    }
  }
  if (!unit.visual_required && !value.passage.trim()) errors.push('지문이 없습니다.')
  if (!unit.translation.trim()) warnings.push('원문 해석 구역을 자동 식별하지 못했습니다. 원본에서 확인해주세요.')
  const source = unit.left_text.replace(/\[수능특강[^\]]*\]/g, '')
  const output = [value.passage, ...value.questions.flatMap((q) => [q.stem, ...q.choices])].join('\n')
  const ec = recall(english(source), english(output))
  const tc = textCoverage(unit.translation, value.translation)
  if (strict) {
    if (!unit.translation.trim()) errors.push('자동 검증: 원문 해석 구역을 확정하지 못했습니다.')
    if (ec < 1) errors.push('자동 검증: 원문 영어 토큰을 전부 대응시키지 못했습니다.')
    if (recall(english(output), english(source)) < 1) errors.push('자동 검증: 원문에 없는 영어 표현 또는 중복이 추가됐습니다.')
    if (unit.translation && tc < 1) errors.push('자동 검증: 원문 해석을 전부 대응시키지 못했습니다.')
    const originalOrder = [...source.matchAll(/(?:^|\n)\s*\(([A-D])\)/g)].map((m) => m[1])
    const extractedOrder = [...value.passage.replace(/<[^>]*>|\*+/g, '').matchAll(/(?:^|\n)\s*\(([A-D])\)/g)].map((m) => m[1])
    if (originalOrder.length > 1 && originalOrder.join('') !== extractedOrder.join('')) errors.push('자동 검증: 원문 문단 기호의 순서가 다릅니다.')
    const fields = [value.passage, value.translation, value.vocabulary, ...value.questions.flatMap((q) => [q.stem, ...q.choices, q.intent, q.solution])]
    if (missingEmphasis(fields, unit.underlines ?? [], /<u>([\s\S]*?)<\/u>/g)) errors.push('자동 검증: PDF 선·글자 좌표로 확인한 원문 밑줄이 누락됐습니다.')
    if (missingEmphasis(fields, unit.bold ?? [], /\*\*([\s\S]*?)\*\*/g)) errors.push('자동 검증: PDF 영문 글꼴에서 확인한 원문 굵은 표시가 누락됐습니다.')
  }
  const outputEnglish = ` ${english(output).join(' ')} `
  // A short missing ending can hide inside a high document-wide recall. Check
  // each native line as well, without crossing the passage/choice boundaries.
  const missingLine = source.split('\n').some((line) => {
    const tokens = english(line)
    if (tokens.length < 6) return false
    return !outputEnglish.includes(` ${tokens.slice(0, 6).join(' ')} `)
      || !outputEnglish.includes(` ${tokens.slice(-6).join(' ')} `)
  })
  if (missingLine) errors.push('영어 원문의 문장 일부가 누락되거나 순서·표현이 달라졌습니다. 지문과 선지를 원문 그대로 확인해주세요.')
  if (ec < 0.97) errors.push(`원문 영어의 일부가 누락됐을 가능성이 있습니다. 대응률 ${Math.round(ec * 1000) / 10}%.`)
  else if (ec < 0.995) warnings.push('영어 원문과 일부 표현이 다릅니다. 지문 마지막 문장·선지·각주를 확인해주세요.')
  if (unit.translation && tc < 0.97) errors.push(`해석이 원문과 다르거나 잘렸을 가능성이 있습니다. 대응률 ${Math.round(tc * 1000) / 10}%.`)
  else if (tc < 0.995) warnings.push('해석의 일부 표현·순서를 원문과 대조해주세요.')
  for (const [label, sourceText, outputText] of [
    ['해설', rightSections(unit.right_text, ['해설', '풀이']), value.questions.map((q) => q.solution).join('\n')],
    ['어휘', bookVocabularyText(rightSections(unit.right_text, ['어휘'])), value.vocabulary],
    ['소재', rightSections(unit.right_text, ['소재']), value.questions.map((q) => q.intent).join('\n')],
  ]) {
    if (!sourceText.trim()) continue
    const coverage = textCoverage(sourceText, outputText)
    if (strict && coverage < 1) errors.push(`자동 검증: 원문 ${label}을 전부 대응시키지 못했습니다.`)
    if (coverage < 0.97) errors.push(`${label}의 원문 일부가 누락되거나 달라졌습니다. 원본과 대조해주세요.`)
    else if (coverage < 0.995) warnings.push(`${label}의 일부 표현·연결을 원문과 확인해주세요.`)
  }
  if (unit.pages.length > 1) warnings.push('연결 페이지를 함께 추출·대조하는 묶음입니다.')
  if (unit.questions.length > 1) warnings.push('여러 문항이 하나의 지문을 공유합니다.')
  if (unit.visual_required) warnings.push('도표·이미지의 기준 자료는 보관된 원본 PDF입니다. 텍스트만으로 도표를 대체하지 않습니다.')
  if (value.questions.some((q) => q.question_type === 'other')) warnings.push('문제 유형을 원문과 대조해주세요.')
  return { errors, warnings, english_coverage: ec, translation_coverage: tc }
}

export function bookPublishReady(units: { extraction: BookExtraction | null; validation: BookValidation; version: number; verified_version: number | null; verification: {status: string} }[], expectedUnits: number, metadataReviewed: boolean) {
  return metadataReviewed && expectedUnits > 0 && units.length === expectedUnits && units.every((u) => !!u.extraction && !u.validation.errors.length && u.verified_version === u.version && u.verification?.status === 'passed')
}
