import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resolveSourceMap, sourceMapSchema, type SourceMap, type SourcePage } from './source-map'

export type SourceDraft = ReturnType<typeof resolveSourceMap>['groups']
const field = z.enum(['passage', 'translation', 'vocabulary', 'stem', 'choice', 'answer', 'intent', 'solution', 'type', 'label'])
export const sourceAuditTargetSchema = z.object({ g: z.number().int().nonnegative(), q: z.number().int().nonnegative().nullable(),
  field, choice: z.number().int().min(0).max(4).nullable() }).strict()
export type SourceAuditTarget = z.infer<typeof sourceAuditTargetSchema>
export const sourceAuditSchema = z.object({
  status: z.enum(['pass', 'repair', 'unreadable']),
  checks: z.object({ content: z.boolean(), mapping: z.boolean(), formatting: z.boolean(), inventory: z.boolean() }).strict(),
  issues: z.array(z.object({ target: sourceAuditTargetSchema.nullable(), kind: z.enum(['native_text', 'mapping', 'formatting', 'metadata', 'inventory']),
    pages: z.array(z.number().int().positive()).min(1).max(4), reason: z.string().min(1).max(1000) }).strict()).max(30),
}).strict()
export type SourceAudit = z.infer<typeof sourceAuditSchema>

/** Some stored responses repeat the target address beside target. Remove only
 * exact duplicates; conflicting addresses and all other unknown fields fail. */
export function parseSourceAuditResponse(value: unknown) {
  if (!value || typeof value !== 'object' || !('issues' in value) || !Array.isArray(value.issues)) return sourceAuditSchema.safeParse(value)
  const issues = value.issues.map((issue: unknown) => {
    if (!issue || typeof issue !== 'object' || !('target' in issue)) return issue
    const parsed = sourceAuditTargetSchema.safeParse(issue.target)
    if (!parsed.success) return issue
    const copy = { ...issue } as Record<string, unknown>
    for (const field of ['g', 'q', 'field', 'choice'] as const) {
      if (field in copy && copy[field] === parsed.data[field]) delete copy[field]
    }
    return copy
  })
  return sourceAuditSchema.safeParse({ ...value, issues })
}
const editRef = sourceMapSchema.shape.groups.element.shape.passage
const sourcePatchSchema = z.object({ before: z.string().max(4096), after: z.string().max(4096) }).strict()
export const selectiveSourceRepairSchema = z.object({ edits: z.array(z.discriminatedUnion('mode', [
  z.object({ target: sourceAuditTargetSchema, mode: z.literal('refs'), refs: editRef }).strict(),
  z.object({ target: sourceAuditTargetSchema, mode: z.literal('text'), text: z.string().max(80_000), pages: z.array(z.number().int().positive()).min(1).max(4) }).strict(),
  z.object({ target: sourceAuditTargetSchema, mode: z.literal('patch'), patches: z.array(sourcePatchSchema).min(1).max(30),
    pages: z.array(z.number().int().positive()).min(1).max(4) }).strict(),
])).max(30), issues: z.array(z.string().min(1).max(1000)).max(30), base_hash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()
/** Whole-field text is accepted only when replaying old responses. New requests
 * use exact anchored patches, except the short answer/type scalar values. */
export const compactSourceRepairSchema = selectiveSourceRepairSchema.superRefine((repair, ctx) => {
  if (!repair.base_hash) ctx.addIssue({ code: 'custom', message: 'Missing candidate hash' })
  for (const edit of repair.edits) {
    if (edit.mode === 'text' && (!['answer', 'type'].includes(edit.target.field) || edit.text.length > 64)) {
      ctx.addIssue({ code: 'custom', message: 'Whole-field text is not permitted in compact repairs' })
    }
    if (edit.mode === 'patch' && ['answer', 'type'].includes(edit.target.field)) {
      ctx.addIssue({ code: 'custom', message: 'Scalar metadata requires an explicit printed value' })
    }
  }
})
export type SelectiveSourceRepair = z.infer<typeof selectiveSourceRepairSchema>
const types = new Set(['purpose', 'mood', 'claim', 'implication', 'topic', 'title', 'summary', 'blank_vocabulary', 'blank_phrase', 'grammar', 'vocabulary', 'reference', 'content_match', 'notice', 'order', 'insert', 'irrelevant', 'long_order', 'long_content_match', 'long_title', 'chart', 'other'])
export const sourceDraftHash = (draft: SourceDraft) => createHash('sha256').update(JSON.stringify(draft)).digest('hex')
export const sourceTargetKey = (t: SourceAuditTarget) => `${t.g}/${t.q ?? '-'}/${t.field}/${t.choice ?? '-'}`

/** Explicit display of the candidate's own answer, never an expected answer. */
export function sourceAuditEvidence(draft: SourceDraft) {
  return draft.map((g) => ({ ...g, extraction: { ...g.extraction, questions: g.extraction.questions.map((q) => ({ ...q,
    printed_answer_symbol: '①②③④⑤'[q.answer - 1] ?? 'invalid' })) } }))
}

/** The error location may be one page, but re-extracting its whole field can
 * require a continuation page. Include both the flagged and current field pages. */
export function sourceRepairPages(issue: SourceAudit['issues'][number], pages: SourcePage[], mapping: SourceMap) {
  const t = issue.target
  let refs: { s: number; e: number }[] = []
  if (t) {
    const g = mapping.groups[t.g]
    if (t.field === 'passage' || t.field === 'translation' || t.field === 'vocabulary') refs = g[t.field]
    else {
      const q = g.questions[t.q!]
      refs = t.field === 'type' ? [...q.label, ...q.stem] : t.field === 'choice' ? q.choices?.[t.choice!] ?? [] : q[t.field]
    }
  }
  return [...new Set([...issue.pages, ...pages.flatMap((p) => p.lines.some((l) => refs.some((r) => l.id >= r.s && l.id <= r.e)) ? [p.page] : [])])].sort((a, b) => a - b)
}

export function sourceTargetValue(draft: SourceDraft, t: SourceAuditTarget): string | number {
  const group = draft[t.g]
  if (!group) throw Error('Unknown audit group')
  if (t.field === 'passage' || t.field === 'translation' || t.field === 'vocabulary') {
    if (t.q !== null || t.choice !== null) throw Error('Group field has a question address')
    return group.extraction[t.field]
  }
  const q = t.q === null ? null : group.extraction.questions[t.q]
  if (!q) throw Error('Unknown audit question')
  if (t.field === 'choice') {
    if (t.choice === null || !q.choices[t.choice]) throw Error('Unknown audit choice')
    return q.choices[t.choice]
  }
  if (t.choice !== null) throw Error('Unexpected choice index')
  if (t.field === 'label') return group.labels[t.q!]
  if (t.field === 'type') return q.question_type
  return q[t.field]
}

export function sourceAuditErrors(audit: SourceAudit, draft: SourceDraft, pages: SourcePage[]) {
  const errors: string[] = [], selected = new Set(pages.map((p) => p.page))
  if (audit.status === 'pass' && (audit.issues.length || Object.values(audit.checks).some((v) => !v))) errors.push('inconsistent_audit_pass')
  if (audit.status === 'repair' && !audit.issues.length) errors.push('repair_without_targets')
  for (const issue of audit.issues) {
    if (issue.pages.some((p) => !selected.has(p))) errors.push('audit_page_outside_window')
    if (!issue.target) { errors.push('unaddressable_inventory_issue'); continue }
    try { sourceTargetValue(draft, issue.target) } catch { errors.push('invalid_audit_target') }
  }
  return errors
}

function safeVisionText(text: string) {
  for (const m of text.matchAll(/<\/?([a-z][\w:-]*)([^>]*)>/gi)) {
    if (!['u', 'strong', 'b', 'em', 'i', 'br'].includes(m[1].toLowerCase()) || m[2].trim().replace(/\/$/, '')) throw Error('Unexpected markup in visual repair')
  }
}
function setText(draft: SourceDraft, t: SourceAuditTarget, text: string) {
  safeVisionText(text)
  if ((t.field === 'stem' || t.field === 'choice') && !text.trim()) throw Error('Essential question field is empty')
  const group = draft[t.g]
  if (t.field === 'passage' || t.field === 'translation' || t.field === 'vocabulary') { group.extraction[t.field] = text; return }
  const q = group.extraction.questions[t.q!]
  if (t.field === 'choice') q.choices[t.choice!] = text
  else if (t.field === 'label') group.labels[t.q!] = text
  else if (t.field === 'type') { if (!types.has(text)) throw Error('Unknown repaired question type'); q.question_type = text }
  else if (t.field === 'answer') {
    const answers = [...text.matchAll(/[①②③④⑤1-5]/g)]
    if (answers.length !== 1) throw Error('Visual repair must reference exactly one printed answer')
    q.answer = '①②③④⑤'.includes(answers[0][0]) ? '①②③④⑤'.indexOf(answers[0][0]) + 1 : Number(answers[0][0])
  } else q[t.field] = text
}

/** Locate every edit in the SAME unmodified field. Never fuzzy-match, normalize
 * whitespace or apply a patch to text produced by another patch. */
export function applySourceTextPatches(text: string, patches: z.infer<typeof sourcePatchSchema>[]) {
  const spans = patches.map(({ before, after }) => {
    if (before === after) throw Error('Source patch makes no change')
    if (!before && (text || patches.length !== 1)) throw Error('Empty patch anchor is only valid for an empty field')
    const start = text.indexOf(before), end = start + before.length
    if (start < 0 || (before && text.indexOf(before, start + 1) !== -1)) throw Error('Source patch anchor must match exactly once')
    const splitsSurrogate = (offset: number) => offset > 0 && offset < text.length
      && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])
    if (splitsSurrogate(start) || splitsSurrogate(end)) throw Error('Source patch splits a Unicode character')
    return { start, end, after }
  }).sort((a, b) => a.start - b.start)
  for (let i = 1; i < spans.length; i++) if (spans[i].start < spans[i - 1].end) throw Error('Overlapping source patches')
  let result = text
  for (const span of spans.toReversed()) result = result.slice(0, span.start) + span.after + result.slice(span.end)
  if (result.length > 80_000) throw Error('Repaired source field is too large')
  return result
}

/** Atomic, allow-listed field changes. Native source remains unchanged and each
 * OCR override records the before/after values and source-image provenance. */
export function applySelectiveSourceRepair(input: { pages: SourcePage[]; mapping: SourceMap; draft: SourceDraft; audit: SourceAudit;
  repair: SelectiveSourceRepair; expectedHash: string; imageHashes: Record<number, string> }) {
  if (sourceDraftHash(input.draft) !== input.expectedHash) throw Error('Stale source repair')
  if ((input.repair.base_hash !== undefined || input.repair.edits.some((e) => e.mode === 'patch'))
    && input.repair.base_hash !== input.expectedHash) throw Error('Stale source patch hash')
  const auditErrors = sourceAuditErrors(input.audit, input.draft, input.pages)
  if (auditErrors.length) throw Error(auditErrors.join(';'))
  if (input.audit.status !== 'repair' || input.repair.issues.length) throw Error('Repair is not actionable')
  const allowed = new Map(input.audit.issues.filter((i) => i.target).map((i) => [sourceTargetKey(i.target!), i]))
  const keys = input.repair.edits.map((e) => sourceTargetKey(e.target))
  if (!keys.length || new Set(keys).size !== keys.length || keys.some((k) => !allowed.has(k)) || [...allowed.keys()].some((k) => !keys.includes(k))) throw Error('Repair must cover exactly the flagged fields')
  const mapping = structuredClone(input.mapping)
  for (const edit of input.repair.edits) {
    sourceTargetValue(input.draft, edit.target)
    if (edit.mode !== 'refs') continue
    const issue = allowed.get(sourceTargetKey(edit.target))!
    for (const range of edit.refs) {
      const referenced = input.pages.flatMap((p) => p.lines).filter((l) => l.id >= range.s && l.id <= range.e)
      const permitted = sourceRepairPages(issue, input.pages, input.mapping)
      if (referenced.some((l) => !permitted.includes(l.page) || !input.imageHashes[l.page])) throw Error('Remapped reference is outside the audited source pages')
    }
    const t = edit.target, g = mapping.groups[t.g]
    if (t.field === 'passage' || t.field === 'translation' || t.field === 'vocabulary') g[t.field] = edit.refs
    else {
      const q = g.questions[t.q!]
      if (t.field === 'type') throw Error('Question type is metadata, not a source span')
      if (t.field === 'choice') { if (!q.choices) throw Error('Inline choice cannot be remapped as a list'); q.choices[t.choice!] = edit.refs }
      else q[t.field] = edit.refs
    }
  }
  const resolved = resolveSourceMap(input.pages, sourceMapSchema.parse(mapping))
  const nativeWarnings = new Set(input.pages.flatMap((p) => p.issues))
  const structuralErrors = resolved.errors.filter((e) => !nativeWarnings.has(e))
  if (structuralErrors.length) throw Error(`Repaired map violates native ownership: ${structuralErrors.join(';')}`)
  // Keep all previous text overrides and untouched fields. Only flagged remaps
  // receive the newly reconstructed native value.
  const draft = structuredClone(input.draft)
  const ledger = input.repair.edits.map((edit) => {
    const before = sourceTargetValue(draft, edit.target)
    if (edit.mode === 'refs') setText(draft, edit.target, String(sourceTargetValue(resolved.groups, edit.target)))
    else {
      const issue = allowed.get(sourceTargetKey(edit.target))!
      const permitted = sourceRepairPages(issue, input.pages, input.mapping)
      if (edit.pages.some((p) => !permitted.includes(p) || !input.imageHashes[p])) throw Error('Repair image is outside the audited source')
      setText(draft, edit.target, edit.mode === 'patch'
        ? applySourceTextPatches(String(before), edit.patches) : edit.text)
    }
    return { target: edit.target, mode: edit.mode, before, after: sourceTargetValue(draft, edit.target),
      imageHashes: Object.fromEntries(sourceRepairPages(allowed.get(sourceTargetKey(edit.target))!, input.pages, input.mapping).map((p) => [p, input.imageHashes[p]])), sourceRefs: edit.mode === 'refs' ? edit.refs : null }
  })
  return { mapping, draft, ledger }
}
