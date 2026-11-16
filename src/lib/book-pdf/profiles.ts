import { findBookSourceLabels } from './source-label'
import { resolveSourceMap, type SourceLine, type SourceMap, type SourcePage, type SourceRef } from './source-map'
import type { BookUnitManifest } from './types'
import { BOOK_PDFIUM_SOURCE, type BookSourceMode } from './source-mode'
import { findBookInsertionParts } from './profile-layout'

export const BOOK_PROFILE_VERSION = 'jugis-two-column-v1'
export type BookProfile = 'reading.chapter' | 'reading.mini_test' | 'suwan.practice' | 'suwan.type' | 'suwan.practical'
export function bookUnitProfile(unit: BookUnitManifest): BookProfile | null {
  const profiles = new Set(unit.questions.map(q => q.source_kind === 'chapter' ? 'reading.chapter'
    : q.source_kind === 'mini_test' ? 'reading.mini_test' : q.source_kind === 'practical' ? 'suwan.practical'
      : q.source_kind === 'type' ? q.section === 'practice' ? 'suwan.practice' : 'suwan.type' : null))
  return profiles.size === 1 ? [...profiles][0] as BookProfile | null : null
}
const wordCombination = /각\s*네모\s*안에서\s*문맥에\s*맞는\s*낱말/u
function printedQuestionNumber(line: string, number: number, enhanced: boolean) {
  return line.match(new RegExp(`^\\s*${number}${enhanced ? '(?:\\s+(?=[\\p{L}(])|(?=[가-힣]))' : '\\s*(?=[가-힣])'}`, 'u'))
}
export function profileQuestionType(stem: string, shared: boolean, enhanced = false) {
  if (enhanced) stem = stem.replace(/의\s*미\s*하\s*는/gu, '의미하는').replace(/일\s*치/gu, '일치')
  if (/도표|그래프/.test(stem)) return 'chart'
  if (/목적/.test(stem)) return 'purpose'
  if (/심경|분위기/.test(stem)) return 'mood'
  if (/주장/.test(stem)) return 'claim'
  if (/의미하는/.test(stem)) return 'implication'
  if (/가리키는 대상/.test(stem)) return 'reference'
  if (/어법/.test(stem)) return 'grammar'
  if (/낱말.*쓰임|문맥상.*적절하지|어휘/.test(stem) || enhanced && wordCombination.test(stem)) return 'vocabulary'
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
export function mapBookProfile(pages: SourcePage[], unit: BookUnitManifest, sourceMode?: BookSourceMode): { mapping: SourceMap | null; reasons: string[]; profile: BookProfile | null } {
  const profile = bookUnitProfile(unit), reasons: string[] = []
  const enhanced = sourceMode === BOOK_PDFIUM_SOURCE
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
  let insertionInstruction: SourceLine | null = null
  for (const l of left) {
    const label = findBookSourceLabels(l.text)
    if (label.length) {
      if (label.length !== 1 || !labels.has(label[0].ref.key) || l.text.trim() !== label[0].raw) return finish(null, ['ambiguous_left_source_label'])
      current = labels.get(label[0].ref.key)!; q[current].label.push(r(l)); continue
    }
    if (/^\s*\[\d+\s*[~～∼-]\s*\d+\].*(?:다음|$)/.test(l.text)) {
      if (enhanced && current < 0 && /글의 흐름으로 보아.*주어진 문장이 들어가기에/u.test(l.text)) insertionInstruction = l
      ignore(l, 'group_instruction')
      continue
    }
    if (insertionInstruction && current < 0 && l.page === insertionInstruction.page
      && insertionInstruction.y - l.y <= 20 && /^(?:가장\s*)?적절한\s*곳을\s*고르시오\.$/u.test(l.text.trim())) {
      ignore(l, 'group_instruction')
      insertionInstruction = null
      continue
    }
    if (/^\s*수능완성\s*[(（]\s*실전\s*[)）]\s*$/.test(l.text)) { ignore(l, 'section_label'); continue }
    if (current < 0) group.passage.push(r(l))
    else blocks[current].push(l)
  }
  const shared = unit.questions.length > 1
  const questionRange = /^\[\s*(\d+)\s*[~～∼-]\s*(\d+)\s*\]$/u
  for (const [i, block] of blocks.entries()) {
    if (!q[i].label.length || !block.length) return finish(null, ['missing_profile_question'])
    if (enhanced && !shared) {
      const promptEnd = block.findIndex(line => /[?？]\s*(?:\[\s*\d점\s*\])?\s*$/u.test(line.text))
      if (promptEnd >= 0 && profileQuestionType(block.slice(0, promptEnd + 1).map(line => line.text).join(' '), false, true) === 'insert') {
        if (group.passage.length) return finish(null, ['unassigned_before_insertion_label'])
        const score = block[promptEnd + 1]
        const promptSize = promptEnd + 1 + Number(!!score && /^\[\s*\d점\s*\]$/u.test(score.text.trim())
          && Math.abs(score.y - block[promptEnd].y) < 1)
        const prompt = block.slice(0, promptSize), parts = findBookInsertionParts(pages, prompt, block.slice(promptSize))
        if (!parts) return finish(null, ['uncertain_insertion_boxes_or_markers'])
        const number = printedQuestionNumber(prompt[0].text, unit.questions[i].number, true)
        if (!number) return finish(null, ['missing_profile_question'])
        q[i].label.push(r(prompt[0], 0, number[0].length))
        q[i].stem.push(r(prompt[0], number[0].length), ...prompt.slice(1).map(l => r(l)), ...parts.sentence.map(l => r(l)))
        group.passage.push(...parts.passage.map(l => r(l)))
        mapping.breaks = [{ after: prompt.at(-1)!.id, before: parts.sentence[0].id, separator: 'paragraph' }]
        q[i].type = 'insert'
        continue
      }
    }
    let body = shared, option = -1
    for (let n = 0; n < block.length; n++) {
      const l = block[n], text = l.text.trim()
      if (/^\*/.test(text)) { group.passage.push(r(l)); continue }
      if (n === 0) {
        const number = printedQuestionNumber(l.text, unit.questions[i].number, enhanced)
        if (number) { q[i].label.push(r(l, 0, number[0].length)); q[i].stem.push(r(l, number[0].length)); continue }
      }
      const stem = q[i].stem.map(ref => block.find(b => b.id === ref.s)?.text ?? '').join(' ')
      const type = profileQuestionType(stem, shared, enhanced)
      const inline = !shared && (type === 'grammar' || type === 'vocabulary' || type === 'reference')
        && !(enhanced && wordCombination.test(stem))
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
    const type = profileQuestionType(stem, shared, enhanced)
    if (!type || type === 'insert') return finish(null, ['ambiguous_profile_stem'])
    q[i].type = type
    if (type === 'blank_phrase' && q[i].choices?.every(refs => refs.map(ref => block.find(l => l.id === ref.s)?.text ?? '').join(' ').replace(/[①②③④⑤]/g, '').trim().split(/\s+/).length === 1)) q[i].type = 'blank_vocabulary'
    if (q[i].choices && q[i].choices!.some(refs => !refs.length)) return finish(null, ['incomplete_profile_choices'])
  }
  let index = 0, explicitlyNamed = false, field: 'answer' | 'intent' | 'translation' | 'solution' | 'vocabulary' | null = null
  for (let n = 0; n < right.length; n++) {
    const l = right[n], text = l.text.trim(), label = findBookSourceLabels(text)
    if (label.length === 1 && labels.has(label[0].ref.key) && text === label[0].raw) { index = labels.get(label[0].ref.key)!; explicitlyNamed = true; ignore(l, 'section_label'); field = null; continue }
    const range = enhanced && shared && !field && text.match(questionRange)
    if (range && Number(range[1]) === unit.questions[0].number && Number(range[2]) === unit.questions.at(-1)?.number
      && right[n + 1]?.text.trim() === '[정답]') { ignore(l, 'group_instruction'); continue }
    const heading = text.match(/^\[\s*(정답|소재|해석|해설|풀이|어휘)\s*\]$/)
    if (heading) {
      const roles = { 정답: 'answer', 소재: 'intent', 해석: 'translation', 해설: 'solution', 풀이: 'solution', 어휘: 'vocabulary' } as const
      field = roles[heading[1] as keyof typeof roles]
      if (field !== 'answer') ignore(l, 'field_label'); else q[index].answer.push(r(l))
      continue
    }
    if (/^\d+$/.test(text) && /^\[\s*정답\s*\]/.test(right[n + 1]?.text.trim() ?? '')) {
      const found = unit.questions.findIndex(ref => ref.number === Number(text))
      if (found >= 0) { index = found; explicitlyNamed = true; field = null; ignore(l, 'section_label'); continue }
    }
    if (field === 'answer') {
      if (!/^[①②③④⑤1-5]$/.test(text)) return finish(null, ['ambiguous_profile_answer'])
      q[index].answer.push(r(l)); field = null
      const expected = unit.questions[index].printed_answer, next = right[n + 1]
      if (enhanced && shared && explicitlyNamed && index === q.length - 1 && expected && next?.page === l.page
        && (text === String(expected) || text === '①②③④⑤'[expected - 1])) {
        const vocabulary = right.findIndex((candidate, k) => k > n + 1 && candidate.text.trim() === '[어휘]')
        const prose = vocabulary > 0 ? right.slice(n + 1, vocabulary) : []
        const sentence = prose.map(candidate => candidate.text).join(' ')
        if (prose.length && prose.every(candidate => candidate.page === l.page && !/^\s*\[/.test(candidate.text))
          && /[가-힣]{2}/u.test(sentence) && sentence.includes('①②③④⑤'[expected - 1])) field = 'solution'
      }
      continue
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
