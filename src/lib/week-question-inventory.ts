import { z } from 'zod'

const questionSchema = z.object({
  section: z.enum(['general', 'written']),
  number: z.number().int().positive(),
  sub_labels: z.array(z.string().regex(/^[a-z]$/).nullable()).min(1),
  display_order: z.number().int().positive(),
  passage_group: z.string().min(1).nullable(),
})

export const weekInventorySchema = z.object({
  counts: z.object({ general: z.number().int().nonnegative(), written: z.number().int().nonnegative() }),
  questions: z.array(questionSchema).min(1),
})

export type WeekQuestionIdentity = z.infer<typeof questionSchema>
export type WeekQuestionTarget = WeekQuestionIdentity & { question_number: number }

export function inventoryLabel(q: WeekQuestionIdentity): string {
  return `${q.section === 'written' ? '서답형' : '일반'} ${q.number}`
}

/** Check an independent PDF text layer as well as the model's declared counts.
 * Shared-passage references count as evidence that a parent exists, never as extra parents.
 * Images without a text layer still use the complete visual inventory. */
export function buildWeekQuestionTargets(input: unknown, nativeText = ''): WeekQuestionTarget[] {
  const inventory = weekInventorySchema.parse(input)
  const keys = new Set<string>()
  const orders = new Set<number>()
  for (const q of inventory.questions) {
    const key = `${q.section}:${q.number}`
    if (keys.has(key)) throw new Error(`문항 목록 중복: ${inventoryLabel(q)}`)
    keys.add(key)
    if (orders.has(q.display_order)) throw new Error('PDF 문항 배치 순서 중복')
    orders.add(q.display_order)
    if (new Set(q.sub_labels).size !== q.sub_labels.length ||
        (q.sub_labels.includes(null) && q.sub_labels.length > 1)) {
      throw new Error(`소문항 목록 오류: ${inventoryLabel(q)}`)
    }
  }
  if ([...orders].some((order) => order > inventory.questions.length)) throw new Error('PDF 문항 배치 순서 누락')
  // A printed shared-passage heading is independent evidence of the relationship.
  for (const match of nativeText.matchAll(/\[(\d+)\s*[,，]\s*서(?:답|술)형\s*(\d+)\]/g)) {
    const general = inventory.questions.find((q) => q.section === 'general' && q.number === Number(match[1]))
    const written = inventory.questions.find((q) => q.section === 'written' && q.number === Number(match[2]))
    if (!general?.passage_group || general.passage_group !== written?.passage_group) {
      throw new Error(`공통 지문 그룹 불일치: ${match[0]}`)
    }
  }
  for (const match of nativeText.matchAll(/\[(\d+)\s*[~～–-]\s*(\d+)\]/g)) {
    const start = Number(match[1]), end = Number(match[2])
    if (end <= start || end - start > 100) continue
    const members = inventory.questions.filter((q) => q.section === 'general' && q.number >= start && q.number <= end)
    if (members.length !== end - start + 1 || !members[0]?.passage_group ||
        members.some((q) => q.passage_group !== members[0].passage_group)) {
      throw new Error(`공통 지문 그룹 불일치: ${match[0]}`)
    }
  }
  // Text-layer parent headings cross-check the inventory's visual reading order.
  const headings: { key: string; position: number }[] = []
  for (const match of nativeText.matchAll(/(?:^|\s)(\d+)\.\s*(?=[가-힣])/g)) {
    headings.push({ key: `general:${Number(match[1])}`, position: match.index })
  }
  for (const match of nativeText.matchAll(/서(?:답|술)형\s*(\d+)\s+(?=[가-힣])/g)) {
    if (/^(?:개|문항)/.test(nativeText.slice(match.index + match[0].length))) continue
    headings.push({ key: `written:${Number(match[1])}`, position: match.index })
  }
  const seenHeadings = new Set<string>()
  let lastOrder = 0
  for (const heading of headings.sort((a, b) => a.position - b.position)) {
    if (seenHeadings.has(heading.key)) continue // repeated answer/explanation heading
    seenHeadings.add(heading.key)
    const q = inventory.questions.find((q) => `${q.section}:${q.number}` === heading.key)
    if (!q) throw new Error(`PDF 문항 목록 누락: ${heading.key}`)
    if (q.display_order <= lastOrder) throw new Error(`PDF 문항 배치 순서 불일치: ${inventoryLabel(q)}`)
    lastOrder = q.display_order
  }
  for (const section of ['general', 'written'] as const) {
    const count = inventory.questions.filter((q) => q.section === section).length
    if (count !== inventory.counts[section]) throw new Error(`문항 목록 개수 불일치: ${section}`)
  }
  for (const match of nativeText.matchAll(/서(?:답|술)형\s*(\d+)(?!\d)/g)) {
    // A cover's "서답형 3 ·" is a count, not a printed question number.
    if (/^\s*(?:개|문항|[·ㆍ•])/.test(nativeText.slice(match.index + match[0].length))) continue
    if (!keys.has(`written:${Number(match[1])}`)) throw new Error(`PDF 문항 목록 누락: 서답형 ${match[1]}`)
  }
  // Explicit numbered written answer slots are independent evidence for leaf coverage.
  // Stop at the next parent heading; shared-passage references and section counts
  // do not match this heading pattern.
  for (const match of nativeText.matchAll(/서(?:답|술)형\s*(\d+)\s+(?=[가-힣])/g)) {
    const remainder = nativeText.slice(match.index + match[0].length)
    const end = remainder.search(/서(?:답|술)형\s*\d+|(?:^|\s)\d+\.\s*[가-힣]/)
    const body = end < 0 ? remainder : remainder.slice(0, end)
    const slots = [...new Set([...body.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
    if (slots.length < 2 || !slots.every((n, i) => n === i + 1)) continue
    const q = inventory.questions.find((q) => q.section === 'written' && q.number === Number(match[1]))
    if (!q || q.sub_labels.length !== slots.length) throw new Error(`PDF 소문항 목록 불일치: 서답형 ${match[1]}`)
  }
  for (const [pattern, section] of [[/객관식\s*(\d+)\s*(?:개|문항|[·ㆍ•])/g, 'general'],
    [/서(?:답|술)형\s*(\d+)\s*(?:개|문항|[·ㆍ•])/g, 'written']] as const) {
    for (const match of nativeText.matchAll(pattern)) {
      if (Number(match[1]) !== inventory.counts[section]) throw new Error(`PDF 총 문항 수 불일치: ${section}`)
    }
  }
  const generalMax = Math.max(0, ...inventory.questions.filter((q) => q.section === 'general').map((q) => q.number))
  return inventory.questions.map((q) => ({ ...q, question_number: q.number + (q.section === 'written' ? generalMax : 0) }))
    .sort((a, b) => a.display_order - b.display_order)
}

type InventoryAnswer = {
  question_number: number
  sub_label: string | null
  source_section?: string
  source_question_number?: number
}

/** Exact multiset comparison: a sibling does not stand in for a missing leaf,
 * duplicate answers and unexpected labels cannot satisfy the inventory. */
export function weekTargetIssues(target: WeekQuestionTarget, answers: InventoryAnswer[]): string[] {
  const issues: string[] = []
  const expected = new Set(target.sub_labels)
  for (const answer of answers) {
    if (answer.question_number !== target.question_number || answer.source_section !== target.section ||
        answer.source_question_number !== target.number || !expected.has(answer.sub_label)) {
      issues.push(`${inventoryLabel(target)}: 문항 식별자/소문항 불일치`)
    }
  }
  for (const label of target.sub_labels) {
    const count = answers.filter((a) => a.question_number === target.question_number && a.sub_label === label &&
      a.source_section === target.section && a.source_question_number === target.number).length
    if (count !== 1) issues.push(`${inventoryLabel(target)}${label ? `(${label})` : ''}: ${count === 0 ? '누락' : '중복'}`)
  }
  return issues
}
