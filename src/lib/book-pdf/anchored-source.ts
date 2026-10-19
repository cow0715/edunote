import { sourceMapSchema, type SourceLine, type SourceMap, type SourcePage, type SourceRef } from './source-map'

type Field = 'answer' | 'intent' | 'translation' | 'solution'
export type AnchoredBlock = { id: string; field: Field; page: number; refs: SourceRef[]; owner: number | null; label: number }
export type AnchoredPlan = { blocks: AnchoredBlock[]; questions: { id: string; number: number; line: number }[];
  connections: { question: string; field: 'answer' | 'intent' | 'solution'; block: string }[] }
const labels: Record<string, Field | 'boundary'> = { 정답: 'answer', Answer: 'answer', 소재: 'intent', 해석: 'translation', Translation: 'translation', 해설: 'solution', 풀이: 'solution', Explanation: 'solution', 어휘: 'boundary', Vocabulary: 'boundary' }
const labelOf = (l: SourceLine) => labels[l.text.trim().replace(/^\[|\]$/g, '')]
const isLabel = (l: SourceLine) => /^\[[^\]]+\]$/.test(l.text.trim()) && !!labelOf(l)

function ranges(lines: SourceLine[], all: SourceLine[]): SourceRef[] {
  const indices = new Map(all.map((l, i) => [l.id, i])), out: SourceRef[] = []
  for (const l of lines) {
    const prior = out.at(-1)
    if (prior && indices.get(prior.e)! + 1 === indices.get(l.id)) prior.e = l.id
    else out.push({ s: l.id, e: l.id })
  }
  return out
}

/** Conservative, page-local label boundaries. No publisher, chapter, fixed
 * left/right roles or first-answer-by-order rule. Open-ended sections stay AI
 * work. All connections are candidates and still require original-image audit. */
export function planAnchoredSource(pages: SourcePage[]): AnchoredPlan {
  const all = pages.flatMap((p) => p.lines), found: AnchoredPlan['questions'] = [], blocks: AnchoredBlock[] = []
  for (const p of pages) {
    if (p.issues.length) continue
    for (const l of p.lines) {
      const m = l.text.match(/^\s*(\d{1,3})[.)]?\s+\S.{3,}/)
      if (!m) continue
      const following = p.lines.filter((n) => n.y <= l.y && l.y - n.y < l.height * 3 && Math.abs(n.x - l.x) < l.height * 2)
      if (!following.some((n) => /[?？]/.test(n.text))) continue
      found.push({ id: `printed:${Number(m[1])}`, number: Number(m[1]), line: l.id })
    }
    const tags = p.lines.filter(isLabel)
    for (const tag of tags) {
      const field = labelOf(tag)
      if (field === 'boundary') continue
      const laneTags = tags.filter((l) => Math.abs(l.x - tag.x) <= Math.max(2, tag.height * 0.4)).sort((a, b) => b.y - a.y)
      const at = laneTags.indexOf(tag), end = laneTags[at + 1]
      // An explicit next label is required; never consume the rest of a page.
      if (!end || end.y >= tag.y) continue
      const extent = p.lines.filter((l) => l.text.trim().length > 8 && l.x >= tag.x - 2 && l.y <= tag.y + 1 && l.y > end.y).map((l) => l.x + l.width)
      // Short answer/topic fields can have no long body. Their right edge is
      // bounded by neighboring non-label text on the same row instead.
      if (!extent.length) extent.push(...p.lines.filter((l) => !isLabel(l) && l.x > tag.x && Math.abs(l.y - tag.y) < 1.5).map((l) => l.x + l.width))
      if (!extent.length) continue
      const right = Math.max(...extent)
      const lane = p.lines.filter((l) => l.x >= tag.x - 2 && l.x + l.width <= right + 2)
      const headers = lane.filter((l) => /^\s*\d{1,3}[.)]?\s*$/.test(l.text) && Math.abs(l.x - tag.x) <= 2)
      const stop = headers.filter((l) => l.y < tag.y && l.y > end.y).sort((a, b) => b.y - a.y)[0]
      const body = lane.filter((l) => l.id !== tag.id && !isLabel(l) && l.y <= tag.y + 1 && l.y > (stop?.y ?? end.y) + 1
        && !(Math.abs(l.y - tag.y) < 1.5 && l.x < tag.x + tag.width - 1))
        .sort((a, b) => b.y - a.y || a.x - b.x)
      if (!body.length || body.some((l) => l.text.includes('[') && l.text.includes(']'))) continue
      if (field === 'answer' && (body.length !== 1 || !/^\s*[①②③④⑤❶❷❸❹❺1-5]\s*$/.test(body[0].text))) continue
      const preceding = headers.filter((l) => l.y > tag.y).sort((a, b) => a.y - b.y)[0]
      const crossed = preceding ? laneTags.filter((l) => l.y < preceding.y && l.y > tag.y && labelOf(l) === 'answer').length : 0
      // A number may own answer -> solution, but cannot leak past a later answer.
      const owner = preceding && crossed <= (field === 'solution' ? 1 : 0) ? Number(preceding.text.replace(/\D/g, '')) : null
      blocks.push({ id: `block:${tag.id}`, field, page: p.page, refs: ranges(body, all), owner, label: tag.id })
    }
  }
  const counts = new Map<number, number>()
  for (const q of found) counts.set(q.number, (counts.get(q.number) ?? 0) + 1)
  const questions = found.filter((q) => counts.get(q.number) === 1)
  const connections: AnchoredPlan['connections'] = []
  for (const block of blocks) {
    if (block.field === 'translation') continue
    // Single-question fallback is only allowed for one page with exactly one
    // printed answer and no shared-question range header.
    const singleton = pages.length === 1 && found.length === 1 && pages[0].lines.filter((l) => isLabel(l) && labelOf(l) === 'answer').length === 1
      && !pages[0].lines.some((l) => /\[\s*\d+\s*[~～–-]\s*\d+\s*\]/.test(l.text))
    const owner = block.owner ?? (singleton ? questions[0]?.number : null), q = questions.find((q) => q.number === owner)
    if (!q || blocks.filter((b) => b.field === block.field && b.owner === block.owner && b.page === block.page).length !== 1) continue
    connections.push({ question: q.id, field: block.field, block: block.id })
  }
  return { blocks, questions, connections }
}

/** Only code-connected bodies leave the coordinate list. Unowned sections keep
 * all native evidence: an explicit label alone does not prove a safe boundary. */
export function anchoredEvidence(pages: SourcePage[], plan: AnchoredPlan) {
  const all = pages.flatMap((p) => p.lines), index = new Map(all.map((l, i) => [l.id, i]))
  const body = (b: AnchoredBlock) => b.refs.flatMap((r) => all.slice(index.get(r.s), index.get(r.e)! + 1))
  const connected = plan.blocks.filter((b) => plan.connections.some((c) => c.block === b.id))
  const hidden = new Set(connected.flatMap((b) => body(b).map((l) => l.id)))
  return { pages: pages.map((p) => ({ page: p.page, size: [Math.round(p.width), Math.round(p.height)], lines: p.lines.filter((l) => !hidden.has(l.id)).map((l) => [l.id, Math.round(l.x), Math.round(l.y), l.text]) })),
    numberedQuestions: plan.questions, codeConnections: plan.connections.map((c) => ({ question: c.question, field: c.field })) }
}

/** Expand references and enforce deterministic connections without silently
 * overwriting a model disagreement. Such disagreement goes to fallback/audit. */
export function expandAnchoredMapping(value: unknown, plan: AnchoredPlan): SourceMap {
  const input = structuredClone(value) as SourceMap
  const blockMap = new Map(plan.blocks.map((b) => [b.id, b]))
  function expand(refs: unknown): SourceRef[] {
    if (!Array.isArray(refs)) throw Error('Invalid hybrid references')
    return refs.flatMap((r: { block?: string } & SourceRef) => {
      if (r && typeof r === 'object' && 'block' in r) {
        if (Object.keys(r).length !== 1 || !blockMap.has(r.block!)) throw Error('Unknown or mixed block reference')
        return structuredClone(blockMap.get(r.block!)!.refs)
      }
      return [r]
    })
  }
  if (!Array.isArray(input?.groups) || !Array.isArray(input?.ignored)) throw Error('Invalid hybrid mapping')
  const questions = input.groups.flatMap((g) => g.questions ?? [])
  for (const g of input.groups) {
    for (const f of ['passage', 'translation', 'vocabulary', 'visual'] as const) g[f] = expand(g[f])
    for (const q of g.questions) {
      for (const f of ['label', 'stem', 'answer', 'intent', 'solution'] as const) {
        const fixed = plan.connections.find((c) => c.question === q.id && c.field === f)
        if (fixed) {
          if (q[f] !== undefined) throw Error('Model overwrote a code connection')
          q[f] = structuredClone(blockMap.get(fixed.block)!.refs)
        } else q[f] = expand(q[f])
      }
      if (q.choices !== null) q.choices = q.choices.map(expand)
    }
  }
  for (const c of plan.connections) if (questions.filter((q) => q.id === c.question).length !== 1) throw Error('Missing or duplicate code-connected question')
  for (const i of input.ignored) i.refs = expand(i.refs)
  return sourceMapSchema.parse(input)
}
