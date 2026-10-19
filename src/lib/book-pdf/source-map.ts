import { z } from 'zod'
import type { BookExtraction } from './types'

/** Native text, not model-written text. Offsets use JavaScript UTF-16 indices. */
export type SourceLine = { id: number; page: number; x: number; y: number; width: number; height: number; text: string; marks: { start: number; end: number; bold: boolean; underline: boolean }[] }
export type SourcePage = { page: number; width: number; height: number; lines: SourceLine[]; issues: string[] }
const ref = z.object({ s: z.number().int().positive(), e: z.number().int().positive().optional(), a: z.number().int().nonnegative().optional(), b: z.number().int().nonnegative().optional() }).strict()
  .transform(({ s, e, ...rest }) => ({ s, e: e ?? s, ...rest }))
const refs = z.array(ref).max(200)
export const sourceMapSchema = z.object({
  groups: z.array(z.object({
    passage: refs, translation: refs, vocabulary: refs, visual: refs,
    questions: z.array(z.object({ id: z.string().min(1).max(100), label: refs, type: z.string().min(1).max(80), stem: refs,
      choices: z.array(refs).length(5).nullable(), answer: refs, intent: refs, solution: refs }).strict()).min(1).max(20),
  }).strict()).min(1).max(50),
  ignored: z.array(z.object({ refs, reason: z.enum(['page_furniture', 'section_label', 'field_label', 'group_instruction', 'vocabulary_bullet']) }).strict()).max(300),
  issues: z.array(z.string().min(1).max(1000)).max(50),
}).strict()
export type SourceMap = z.infer<typeof sourceMapSchema>
export type SourceRef = z.infer<typeof ref>

function escaped(text: string) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\*_\[\]]/g, '\\$&') }
function marked(line: SourceLine, start: number, end: number) {
  let output = '', pending = '', previous = -1
  const flush = () => { if (!pending) return; let part = escaped(pending); if (previous & 2) part = `<u>${part}</u>`; if (previous & 1) part = `<strong>${part}</strong>`; output += part; pending = '' }
  for (let n = start; n < end; n++) {
    const marks = line.marks.filter((m) => n >= m.start && n < m.end)
    const flags = (marks.some((m) => m.bold) ? 1 : 0) | (marks.some((m) => m.underline) ? 2 : 0)
    if (flags !== previous) { flush(); previous = flags }
    pending += line.text[n]
  }
  flush()
  return output
}

/** Bounds, source ordering, native ownership and missing characters are checked
 * independently of the model. This does not prove the semantic role is correct. */
export function resolveSourceMap(pages: SourcePage[], input: SourceMap) {
  const lines = pages.flatMap((p) => p.lines), byId = new Map(lines.map((l, i) => [l.id, { line: l, index: i }]))
  const owners = new Map<string, string>(), errors = [...pages.flatMap((p) => p.issues), ...input.issues]
  const allKeys = input.groups.flatMap((g) => g.questions.map((q) => q.id))
  if (new Set(lines.map((l) => l.id)).size !== lines.length) errors.push('duplicate_native_line_id')
  if (new Set(allKeys).size !== allKeys.length) errors.push('duplicate_question_id')
  function read(ranges: SourceRef[], owner: string, claim = true, raw = false) {
    const output: string[] = [], used = new Set<string>()
    for (const range of ranges) {
      const first = byId.get(range.s), last = byId.get(range.e)
      if (!first || !last || first.index > last.index) { errors.push(`${owner}:invalid_source_range`); continue }
      const selected = lines.slice(first.index, last.index + 1)
      for (let j = 0; j < selected.length; j++) {
        const line = selected[j], a = j === 0 ? range.a ?? 0 : 0, b = j === selected.length - 1 ? range.b ?? line.text.length : line.text.length
        if (a >= b || b > line.text.length || a > line.text.length) { errors.push(`${owner}:invalid_character_offset`); continue }
        for (let k = a; k < b; k++) {
          if (/\s/.test(line.text[k])) continue
          const key = `${line.id}:${k}`
          if (used.has(key)) errors.push(`${owner}:repeated_source_character`)
          used.add(key)
          if (claim) {
            const prior = owners.get(key)
            // Common topic may be linked to several questions in the same group.
            if (prior && prior !== owner && !(prior.endsWith(':intent') && owner.endsWith(':intent') && prior.split(':')[0] === owner.split(':')[0])) errors.push(`${owner}:overlapping_source:${line.id}`)
            owners.set(key, owner)
          }
        }
        output.push(raw ? line.text.slice(a, b) : marked(line, a, b))
      }
    }
    return output.join('\n').trim()
  }
  const groups = input.groups.map((group, i) => {
    const prefix = `g${i}`, passage = read(group.passage, `${prefix}:passage`)
    const translation = read(group.translation, `${prefix}:translation`), vocabulary = read(group.vocabulary, `${prefix}:vocabulary`)
    read(group.visual, `${prefix}:visual`)
    const questions = group.questions.map((q, n) => {
      const key = `${prefix}:q${n}`, label = read(q.label, `${key}:label`), stem = read(q.stem, `${key}:stem`)
      const choices = q.choices?.map((r, k) => read(r, `${key}:choice${k}`)) ?? ['①', '②', '③', '④', '⑤']
      const normalizedMarkers = passage.replace(/[❶❷❸❹❺]/g, (c) => '①②③④⑤'['❶❷❸❹❺'.indexOf(c)])
      if (!q.choices && !'①②③④⑤'.split('').every((c) => normalizedMarkers.includes(c))) errors.push(`${key}:inline_choices_missing_from_passage`)
      const answerText = read(q.answer, `${key}:answer`, true, true), answers = [...answerText.matchAll(/[①②③④⑤1-5]/g)]
      if (answers.length !== 1) errors.push(`${key}:ambiguous_printed_answer`)
      const answer = answers.length === 1 ? ('①②③④⑤'.includes(answers[0][0]) ? '①②③④⑤'.indexOf(answers[0][0]) + 1 : Number(answers[0][0])) : 0
      if (!stem || choices.some((c) => !c)) errors.push(`${key}:missing_stem_or_choice`)
      const intent = read(q.intent, `${prefix}:q${n}:intent`), solution = read(q.solution, `${key}:solution`)
      return { key: q.id, question_type: q.type, stem, choices, answer, intent, solution, label }
    })
    const extraction: BookExtraction = { passage, translation, vocabulary, questions: questions.map((q) => ({ key: q.key, question_type: q.question_type,
      stem: q.stem, choices: q.choices, answer: q.answer, intent: q.intent, solution: q.solution })) }
    return { extraction, labels: questions.map((q) => q.label) }
  })
  for (const [i, ignored] of input.ignored.entries()) {
    const text = read(ignored.refs, `ignored${i}`, true, true)
    // Label-only omissions must not hide a source sentence.
    if (ignored.reason === 'field_label' && !/^\s*(?:\[(?:정답|해석|해설|풀이|어휘|소재|Answer|Translation|Explanation|Vocabulary)\]\s*)+$/.test(text)) errors.push(`ignored${i}:not_a_field_label`)
    if (ignored.reason === 'vocabulary_bullet' && !/^[\so□▪▫◦○●]+$/.test(text)) errors.push(`ignored${i}:not_a_list_bullet`)
    if (ignored.reason === 'page_furniture' && ignored.refs.some((r) => {
      const l = byId.get(r.s)?.line, p = pages.find((p) => p.page === l?.page)
      return !l || !p || (l.y > p.height * 0.075 && l.y < p.height * 0.925 && l.x > p.width * 0.04 && l.x + l.width < p.width * 0.96)
    })) errors.push(`ignored${i}:furniture_inside_body`)
  }
  const uncovered = lines.flatMap((line) => {
    const missing = Array.from({ length: line.text.length }, (_, k) => k).some((k) => !/\s/.test(line.text[k]) && !owners.has(`${line.id}:${k}`))
    return missing ? [line.id] : []
  })
  if (uncovered.length) errors.push(`unassigned_native_lines:${uncovered.join(',')}`)
  return { groups, errors: [...new Set(errors)], uncovered, nativeLineCount: lines.length,
    status: errors.length ? 'unresolved' as const : 'mapped' as const }
}

/** Compact layout evidence without a fixed left/right meaning. */
export function sourceMapEvidence(pages: SourcePage[]) {
  return pages.map((p) => ({ page: p.page, size: [Math.round(p.width), Math.round(p.height)],
    lines: p.lines.map((l) => [l.id, Math.round(l.x), Math.round(l.y), l.text]) }))
}
