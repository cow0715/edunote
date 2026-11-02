import { findBookSourceLabels } from './source-label'
import { resolveSourceMap, type SourceLine, type SourceMap, type SourcePage, type SourceRef } from './source-map'
import type { BookUnitManifest } from './types'

export const BOOK_PROFILE_VERSION = 'jugis-two-column-v1'
export type BookProfile = 'reading.chapter' | 'reading.mini_test' | 'suwan.practice' | 'suwan.type' | 'suwan.practical'
export function bookUnitProfile(unit: BookUnitManifest): BookProfile | null {
  const profiles = new Set(unit.questions.map(q => q.source_kind === 'chapter' ? 'reading.chapter'
    : q.source_kind === 'mini_test' ? 'reading.mini_test' : q.source_kind === 'practical' ? 'suwan.practical'
      : q.source_kind === 'type' ? q.section === 'practice' ? 'suwan.practice' : 'suwan.type' : null))
  return profiles.size === 1 ? [...profiles][0] as BookProfile | null : null
}
export function profileQuestionType(stem: string, shared: boolean) {
  if (/도표|그래프/.test(stem)) return 'chart'
  if (/목적/.test(stem)) return 'purpose'
  if (/심경|분위기/.test(stem)) return 'mood'
  if (/주장/.test(stem)) return 'claim'
  if (/의미하는/.test(stem)) return 'implication'
  if (/가리키는 대상/.test(stem)) return 'reference'
  if (/어법/.test(stem)) return 'grammar'
  if (/낱말.*쓰임|문맥상.*적절하지|어휘/.test(stem)) return 'vocabulary'
  if (/제목/.test(stem)) return shared ? 'long_title' : 'title'
  if (/주제|요지/.test(stem)) return 'topic'
  if (/요약/.test(stem)) return 'summary'
  if (/빈칸/.test(stem)) return 'blank_phrase'
  if (/순서/.test(stem)) return shared ? 'long_order' : 'order'
  if (/들어가기|들어갈.*곳/.test(stem)) return 'insert'
  if (/관계 없는|관계없는/.test(stem)) return 'irrelevant'
  if (/일치|적절하지 않은/.test(stem)) return shared ? 'long_content_match' : 'content_match'
  return null
}

/** This adapter assigns source spans, never rewrites prose. Every character must
 * pass the same independent ownership check as an AI-produced mapping. */
export function mapBookProfile(pages: SourcePage[], unit: BookUnitManifest): { mapping: SourceMap | null; reasons: string[]; profile: BookProfile | null } {
  const profile = bookUnitProfile(unit), reasons: string[] = []
  const finish = (mapping: SourceMap | null, errors: string[] = reasons) => ({ profile, mapping, reasons: errors })
  if (!profile || unit.visual_required) return finish(null, ['profile_requires_targeted_mapping'])
  const q = unit.questions.map(ref => ({ id: ref.key, label: [] as SourceRef[], type: 'other', stem: [] as SourceRef[],
    choices: null as SourceRef[][] | null, answer: [] as SourceRef[], intent: [] as SourceRef[], solution: [] as SourceRef[] }))
  const group = { passage: [] as SourceRef[], translation: [] as SourceRef[], vocabulary: [] as SourceRef[], visual: [] as SourceRef[], questions: q }
  const mapping: SourceMap = { groups: [group], ignored: [], issues: [] }
  const r = (l: SourceLine, a?: number, b?: number): SourceRef => ({ s: l.id, e: l.id, ...(a ? { a } : {}), ...(b !== undefined ? { b } : {}) })
  const ignore = (l: SourceLine, reason: SourceMap['ignored'][number]['reason'], a?: number, b?: number) => mapping.ignored.push({ refs: [r(l, a, b)], reason })
  const left: SourceLine[] = [], right: SourceLine[] = []
  for (const p of pages) {
    const lines = [...p.lines].sort((a, b) => b.y - a.y || a.x - b.x)
    for (const l of lines) {
      if (l.y < 32 || l.y > p.height - 30 || l.x >= p.width * .95) ignore(l, 'page_furniture')
      else (l.x < p.width / 2 ? left : right).push(l)
    }
  }
  const labels = new Map(unit.questions.map((ref, i) => [ref.key, i]))
  const blocks: SourceLine[][] = q.map(() => [])
  let current = -1
  for (const l of left) {
    const label = findBookSourceLabels(l.text)
    if (label.length) {
      if (label.length !== 1 || !labels.has(label[0].ref.key) || l.text.trim() !== label[0].raw) return finish(null, ['ambiguous_left_source_label'])
      current = labels.get(label[0].ref.key)!; q[current].label.push(r(l)); continue
    }
    if (/^\s*\[\d+\s*[~～∼-]\s*\d+\].*(?:다음|$)/.test(l.text)) { ignore(l, 'group_instruction'); continue }
    if (/^\s*수능완성\s*[(（]\s*실전\s*[)）]\s*$/.test(l.text)) { ignore(l, 'section_label'); continue }
    if (current < 0) group.passage.push(r(l))
    else blocks[current].push(l)
  }
  const shared = unit.questions.length > 1
  for (const [i, block] of blocks.entries()) {
    if (!q[i].label.length || !block.length) return finish(null, ['missing_profile_question'])
    let body = shared, option = -1
    for (let n = 0; n < block.length; n++) {
      const l = block[n], text = l.text.trim()
      if (/^\*/.test(text)) { group.passage.push(r(l)); continue }
      if (n === 0) {
        const number = l.text.match(new RegExp(`^\\s*${unit.questions[i].number}\\s*(?=[가-힣])`))
        if (number) { q[i].label.push(r(l, 0, number[0].length)); q[i].stem.push(r(l, number[0].length)); continue }
      }
      const stem = q[i].stem.map(ref => block.find(b => b.id === ref.s)?.text ?? '').join(' ')
      const type = profileQuestionType(stem, shared)
      const inline = !shared && (type === 'grammar' || type === 'vocabulary' || type === 'reference')
        && !block.some((line, k) => line.text.trim() === '①' && /^\s*\(a\)/.test(block[k + 1]?.text ?? ''))
      if (/^[①②③④⑤]$/.test(text) && !inline) {
        const index = '①②③④⑤'.indexOf(text)
        if (index !== option + 1) return finish(null, ['ambiguous_profile_choices'])
        q[i].choices ??= [[], [], [], [], []]; option = index; q[i].choices![index].push(r(l)); continue
      }
      if (option >= 0) q[i].choices![option].push(r(l))
      else if (shared) q[i].stem.push(r(l))
      else {
        if (!body && ((/[a-z]{2}/i.test(text) && !/[가-힣]{2}/.test(text)) || /^\([A-D]\)$/.test(text))) body = true
        if (body) group.passage.push(r(l)); else q[i].stem.push(r(l))
      }
    }
    const stem = q[i].stem.map(ref => block.find(l => l.id === ref.s)?.text ?? '').join(' ')
    const type = profileQuestionType(stem, shared)
    if (!type || type === 'insert') return finish(null, ['ambiguous_profile_stem'])
    q[i].type = type
    if (type === 'blank_phrase' && q[i].choices?.every(refs => refs.map(ref => block.find(l => l.id === ref.s)?.text ?? '').join(' ').replace(/[①②③④⑤]/g, '').trim().split(/\s+/).length === 1)) q[i].type = 'blank_vocabulary'
    if (q[i].choices && q[i].choices!.some(refs => !refs.length)) return finish(null, ['incomplete_profile_choices'])
  }
  let index = 0, field: 'answer' | 'intent' | 'translation' | 'solution' | 'vocabulary' | null = null
  for (let n = 0; n < right.length; n++) {
    const l = right[n], text = l.text.trim(), label = findBookSourceLabels(text)
    if (label.length === 1 && labels.has(label[0].ref.key) && text === label[0].raw) { index = labels.get(label[0].ref.key)!; ignore(l, 'section_label'); field = null; continue }
    const heading = text.match(/^\[\s*(정답|소재|해석|해설|풀이|어휘)\s*\]$/)
    if (heading) {
      const roles = { 정답: 'answer', 소재: 'intent', 해석: 'translation', 해설: 'solution', 풀이: 'solution', 어휘: 'vocabulary' } as const
      field = roles[heading[1] as keyof typeof roles]
      if (field !== 'answer') ignore(l, 'field_label'); else q[index].answer.push(r(l))
      continue
    }
    if (/^\d+$/.test(text) && /^\[\s*정답\s*\]/.test(right[n + 1]?.text.trim() ?? '')) {
      const found = unit.questions.findIndex(ref => ref.number === Number(text))
      if (found >= 0) { index = found; field = null; ignore(l, 'section_label'); continue }
    }
    if (field === 'answer') {
      if (!/^[①②③④⑤1-5]$/.test(text)) return finish(null, ['ambiguous_profile_answer'])
      q[index].answer.push(r(l)); field = null; continue
    }
    if (field) {
      const refs = field === 'translation' || field === 'vocabulary' ? group[field] : q[index][field]
      const bullet = field === 'vocabulary' ? l.text.match(/^\s*[□▪▫◦○●\uF06F]\s*/) : null
      if (bullet) { ignore(l, 'vocabulary_bullet', 0, bullet[0].length); if (bullet[0].length < l.text.length) refs.push(r(l, bullet[0].length)) }
      else refs.push(r(l))
    } else if (/^(?:Week\s*\d+.*|Exercise\s*[\d~～∼-]+|Mini\s*Test\s*\d+.*|Practice|\d+(?:\s*[~～∼-]\s*\d+)?)$/i.test(text)) ignore(l, 'section_label')
    else return finish(null, ['unassigned_profile_right_region'])
  }
  const commonIntent = q.filter(question => question.intent.length)
  if (commonIntent.length === 1 && shared) for (const question of q) if (!question.intent.length) question.intent = [...commonIntent[0].intent]
  if (!group.passage.length || !group.translation.length || q.some(question => !question.solution.length || !question.stem.length)) return finish(null, ['profile_field_boundary_missing'])
  const resolved = resolveSourceMap(pages, mapping), warnings = new Set(pages.flatMap(p => p.issues))
  reasons.push(...resolved.errors.filter(error => !warnings.has(error)))
  return finish(reasons.length ? null : mapping)
}
