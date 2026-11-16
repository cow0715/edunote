import type { BookExtraction } from './types'
import type { SourceLine, SourcePage, SourceRef } from './source-map'
import { sourceGlyphOrigin } from './layout-source'
import { hasInlineBankChoices } from '../bank-numbered-text'
import { materialBoldHeading, materialClosing, materialGreeting, materialListStart, materialNoticeField } from '../material-block-boundaries'

const circles = '①②③④⑤', filled = '❶❷❸❹❺'
const inlineMarks = /<\/?(?:strong|u|em|b|i)>/giu
const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' }
const plainLine = (line: string) => line.replace(inlineMarks, '').replace(/&(?:amp|lt|gt|quot);/gu, entity => entities[entity])
const normalize = (char: string) => filled.includes(char) ? circles[filled.indexOf(char)]
  : char.replace(/[‘’]/u, "'").replace(/[“”]/u, '"')

type Character = { char: string; start: number; end: number }
type NativeCharacter = Character & { line: SourceLine }

function characters(text: string, markup = false): Character[] {
  const pattern = markup ? /<\/?(?:strong|u|em|b|i)>|&(?:amp|lt|gt|quot);|\\[\\*_[\]]|[\s\S]/giu : /[\s\S]/gu
  return [...text.matchAll(pattern)].flatMap(match => {
    const value = match[0]
    if (!/\S/u.test(value) || markup && value.length > 1 && value.startsWith('<')) return []
    const char = markup && value.startsWith('\\') && value.length === 2 ? value[1] : entities[value] ?? value
    return [{ char: normalize(char), start: match.index, end: match.index + value.length }]
  })
}

function sourceCharacters(pages: SourcePage[], refs: SourceRef[]): NativeCharacter[] {
  const lines = pages.flatMap(page => page.lines)
  const indices = new Map(lines.map((line, index) => [line.id, index]))
  return refs.flatMap(ref => {
    const start = indices.get(ref.s), end = indices.get(ref.e)
    if (start === undefined || end === undefined || start > end) return []
    return lines.slice(start, end + 1).flatMap((line, index) => {
      const offset = index === 0 ? ref.a ?? 0 : 0
      return characters(line.text.slice(offset, start + index === end ? ref.b : undefined))
        .map(token => ({ ...token, start: token.start + offset, end: token.end + offset, line }))
    })
  })
}

function matchingRun(body: Character[], source: NativeCharacter[], i: number, j: number, direction: number) {
  let length = 0
  for (let step = 1; step <= 20; step++) {
    const left = body[i + step * direction]?.char
    if (!left || left !== source[j + step * direction]?.char) break
    length++
  }
  return length
}

function matchedBoundary(body: Character[], source: NativeCharacter[], index: number) {
  const matches = source.flatMap((native, j) => native.char === body[index].char && source[j + 1]?.char === body[index + 1].char ? [{
    j, score: matchingRun(body, source, index, j, -1) + matchingRun(body, source, index, j, 1),
  }] : []).sort((a, b) => b.score - a.score)
  const best = matches[0]
  if (!best || best.score < 12 || (matches[1] && best.score - matches[1].score < 4)) return undefined
  return [source[best.j], source[best.j + 1]] as const
}

function sourceSeparator(left: NativeCharacter, right: NativeCharacter) {
  if (left.line.id === right.line.id) {
    const gap = left.line.text.slice(left.end, right.start)
    return left.end <= right.start && /^\s*$/u.test(gap) ? gap : undefined
  }
  if (left.line.page !== right.line.page || Math.abs(left.line.y - right.line.y) > .7) return undefined
  // Atomized pieces from the same printed row carry the exact spaces in their text.
  // A wide or reversed horizontal gap can be a separate column.
  const horizontalGap = right.line.x - left.line.x - left.line.width
  if (right.line.x <= left.line.x || horizontalGap < -1 || horizontalGap > 12) return undefined
  const suffix = left.line.text.slice(left.end), prefix = right.line.text.slice(0, right.start)
  if (!/^\s*$/u.test(suffix + prefix)) return undefined
  return suffix + prefix || (horizontalGap > 1.4 ? ' ' : '')
}

/** Reconcile only whitespace around inline numbers using their mapped PDF text and
 * coordinates. Ambiguous matches and other line breaks retain the audited value. */
export function restoreInlineSourceBreaks(value: BookExtraction, pages: SourcePage[], passageRefs: SourceRef[]) {
  if (!value.questions.some(q => hasInlineBankChoices(q.choices, value.passage)
    || q.choices.length === 0 && ['grammar', 'vocabulary', 'irrelevant', 'insert', 'chart'].includes(q.question_type))) return value
  const body = characters(value.passage, true)
  const source = sourceCharacters(pages, passageRefs)
  const edits = new Map<number, { end: number; text: string }>()
  for (const [i, token] of body.entries()) {
    if (!circles.includes(token.char)) continue
    const matches = source.flatMap((candidate, j) => candidate.char === token.char ? [{
      j, score: matchingRun(body, source, i, j, -1) + matchingRun(body, source, i, j, 1),
    }] : []).sort((a, b) => b.score - a.score)
    const match = matches[0]
    if (!match || match.score < 12 || (matches[1] && match.score - matches[1].score < 4)) continue
    const edges = [i - 1, i]
    if (body[i - 1]?.char === '(') edges.push(i - 2)
    if (body[i + 1]?.char === ')') edges.push(i + 1)
    for (const edge of edges) {
      const left = body[edge], right = body[edge + 1], j = match.j + edge - i
      const nativeLeft = source[j], nativeRight = source[j + 1]
      if (!left || !right || nativeLeft?.char !== left.char || nativeRight?.char !== right.char) continue
      const gap = value.passage.slice(left.end, right.start)
      if (!/^\s*$/u.test(gap.replace(inlineMarks, ''))) continue
      const separator = sourceSeparator(nativeLeft, nativeRight)
      if (separator === undefined || !/[\r\n]/u.test(gap) || /\n[ \t]*\r?\n/u.test(gap)) continue
      const tags = gap.match(inlineMarks)?.join('') ?? ''
      const opening = tags.search(/<[a-z]/iu)
      const position = opening < 0 ? tags.length : opening
      edits.set(left.end, { end: right.start, text: tags.slice(0, position) + separator + tags.slice(position) })
    }
  }
  let passage = value.passage
  for (const [start, edit] of [...edits].sort(([a], [b]) => b - a)) {
    passage = passage.slice(0, start) + edit.text + passage.slice(edit.end)
  }
  return { ...value, passage }
}

const structuralStart = /^(?:\\?\*{1,3}(?=\s|\w|[가-힣])|\([A-Z]\)(?:\s|$)|\\?\[[A-Z]\]|\\?\[(?:Source|출처)\\?\])/u
const proseStart = /[\p{L}\p{N}①-⑤("'“‘\[—+−=]/u
const footnoteStart = /^\*{1,3}(?=\s|\p{L})/u
const footnoteLabelAtEnd = /(?:^|\s)\*{1,3}[A-Za-z][\w'’-]*(?:[ \t]+[\w'’-]+)*:\s*$/u
const summaryArrow = /^[↓⇩▼▾\uF000\uF03B\u{F003B}]$/u
const summaryBlank = /_{2,}\([A-Z]\)_{2,}/u
const listMarker = /^(?:[•●○◆■□▶▪▫‣∙·※]|[-–—]|\d+[.)])\s*/u
const emailAddress = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9]+(?:[.-][A-Z0-9]+)*\.[A-Z]{2,}$/iu

function wrapsEmail(left: string, right: string) {
  const prefix = left.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~@-]+$/iu)?.[0]
  const suffix = right.match(/^[a-z0-9@._-]+/u)?.[0]?.replace(/\.$/u, '')
  if (!prefix || !suffix || emailAddress.test(prefix.replace(/\.$/u, ''))) return false
  return (suffix.startsWith('@') || prefix.includes('@'))
    && emailAddress.test(prefix + suffix)
}

function printedHeading(line: SourceLine) {
  const prefix = line.text.match(listMarker)?.[0].length ?? 0
  const text = line.text.slice(prefix)
  return /[A-Za-z]/u.test(text) && text.split('').every((char, i) =>
    /\s/u.test(char) || line.marks.some(mark => mark.bold && mark.start <= i + prefix && mark.end > i + prefix))
}

function printedRows(lines: SourceLine[]) {
  const byPage = new Map<number, SourceLine[]>()
  for (const line of lines) byPage.set(line.page, [...(byPage.get(line.page) ?? []), line])
  const table = new Set<SourceLine>()
  const pitches = new Map<number, number>()
  const rowBounds = new Map<SourceLine, { left: number; right: number }>()
  const pageRight = new Map<number, number>()
  const visualLines: SourceLine[] = []
  const visualRows: SourceLine[][] = []
  for (const [page, pageLines] of byPage) {
    const rows: SourceLine[][] = []
    for (const line of [...pageLines].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.at(-1)
      if (row && Math.abs(row[0].y - line.y) <= .7) row.push(line)
      else rows.push([line])
    }
    const distances = rows.slice(1).map((row, i) => rows[i][0].y - row[0].y)
      .filter(distance => distance >= 7 && distance <= 40).sort((a, b) => a - b)
    if (distances.length) pitches.set(page, distances[Math.floor(distances.length / 2)])
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x)
      const bounds = { left: row[0].x, right: Math.max(...row.map(line => line.x + line.width)) }
      for (const line of row) rowBounds.set(line, bounds)
      visualLines.push(...row)
      visualRows.push(row)
    }
    const edges = rows.map(row => rowBounds.get(row[0])!.right).sort((a, b) => a - b)
    pageRight.set(page, edges[Math.floor((edges.length - 1) * .75)])
    for (const [index, row] of rows.entries()) {
      const bounds = rowBounds.get(row[0])!
      const hasColumnGap = row.slice(1).some((line, i) => line.x - row[i].x - row[i].width >= 18)
      const fullProseNeighbors = [rows[index - 1], rows[index + 1]].filter(neighbor => {
        if (neighbor?.length !== 1) return false
        const [line] = neighbor
        return Math.abs(line.y - row[0].y) <= (pitches.get(page) ?? 0) * 1.15 &&
          Math.abs(line.x - bounds.left) <= 12 && Math.abs(line.x + line.width - bounds.right) < 4
      }).length
      const surroundedByProse = row.length >= 4 && fullProseNeighbors >= 1 || row.length === 3 && fullProseNeighbors === 2
      if (hasColumnGap && !surroundedByProse) row.forEach(line => table.add(line))
    }
  }
  return { table, pitches, rowBounds, pageRight, visualLines, visualRows }
}

const anchorCharacter = /[\p{L}\p{N}①-⑤]/u
const anchorText = (text: string) => [...text.toLowerCase()].filter(char => anchorCharacter.test(char)).join('')

function anchorSpan(tokens: NativeCharacter[]) {
  const letters = tokens.filter(token => anchorCharacter.test(token.char))
  return { letters, text: letters.map(token => token.char.toLowerCase()).join('') }
}

/** Match the two printed row edges independently when glyph extraction inserts
 * footer text, drops punctuation or interleaves adjacent table cells. */
function rowEdgeMatch(previous: string, next: string, rows: NativeCharacter[][], pitches: Map<number, number>,
  heights: Map<number, number>, table: Set<SourceLine>) {
  const left = anchorText(previous), right = anchorText(next)
  if (left.length < 6 || right.length < 4 || left.length + right.length < 16) return undefined
  const suffix = left.slice(-Math.min(16, left.length)), prefix = right.slice(0, 16)
  const spans = rows.map(tokens => anchorSpan(tokens))
  const candidates: { left: NativeCharacter; right: NativeCharacter; cell: boolean }[] = []
  for (const span of spans) {
    if (!span.text.endsWith(suffix)) continue
    const a = span.letters.at(-1)!
    const start = span.letters[span.text.length - left.length]
    for (const rightSpan of spans) {
      if (!rightSpan.text.startsWith(prefix)) continue
      const b = rightSpan.letters[0]
      const pitch = pitches.get(a.line.page)
      const step = a.line.page === b.line.page && pitch !== undefined && a.line.y - b.line.y > 0
        && a.line.y - b.line.y <= pitch * 1.25
      const pageBreak = b.line.page === a.line.page + 1 && a.line.y < 55
        && (heights.get(b.line.page) ?? Infinity) - b.line.y < 85
      if (!step && !pageBreak) continue
      const leftX = start && span.text.endsWith(left) ? sourceGlyphOrigin(start.line, start.start) ?? start.line.x : a.line.x
      const rightX = sourceGlyphOrigin(b.line, b.start) ?? b.line.x
      const cell = table.has(a.line) || table.has(b.line)
      if (cell && (!step || !start || !span.text.endsWith(left) || Math.abs(leftX - rightX) > 9)) continue
      candidates.push({ left: a, right: b, cell })
    }
  }
  const pairs = candidates.filter((candidate, i) => candidates.findIndex(other =>
    other.left === candidate.left && other.right === candidate.right) === i)
  return pairs.length === 1 ? pairs[0] : undefined
}

function tableColumnTokens(rows: NativeCharacter[][], table: Set<SourceLine>) {
  const groups = new Map<number, NativeCharacter[][]>()
  for (const row of rows) {
    const page = row[0]?.line.page
    if (page === undefined) continue
    const group = groups.get(page)
    if (group) group.push(row)
    else groups.set(page, [row])
  }
  const columns: NativeCharacter[][] = []
  for (const pageRows of groups.values()) {
    const starts: { x: number; y: number }[] = []
    for (const row of pageRows) {
      const lines = [...new Set(row.map(token => token.line))]
      for (const line of lines.slice(1)) if (table.has(line)) starts.push({ x: line.x, y: line.y })
    }
    const groupsByOrigin: { x: number; ys: number[] }[] = []
    for (const start of starts.sort((a, b) => a.x - b.x)) {
      const column = groupsByOrigin.at(-1)
      if (column && start.x - column.x <= 8) column.ys.push(start.y)
      else groupsByOrigin.push({ x: start.x, ys: [start.y] })
    }
    const repeated = groupsByOrigin.filter(column => new Set(column.ys).size >= 3)
    for (const [index, column] of repeated.entries()) {
      const top = Math.max(...column.ys) + 23, bottom = Math.min(...column.ys) - 23
      const next = repeated[index + 1]?.x ?? Infinity
      columns.push(pageRows.flatMap(row => row.filter(token => {
        const x = sourceGlyphOrigin(token.line, token.start)
        return x !== undefined && x >= column.x - 1 && x < next - 1 && token.line.y >= bottom && token.line.y <= top
      })))
    }
  }
  return columns
}

/** Fold physical line wraps in a paragraph while keeping printed structure. */
export function normalizeBookPassageParagraphs(value: BookExtraction, pages: SourcePage[], passageRefs: SourceRef[]) {
  const prepared = restoreInlineSourceBreaks(value, pages, passageRefs)
  const summary = value.questions.some(question => question.question_type === 'summary')
  const text = summary ? prepared.passage.replace(/^[ \t]*[\uF000\uF03B\u{F003B}][ \t]*(?=\r?$)/gmu, '↓') : prepared.passage
  const summaryBoundary = summary ? [...text.matchAll(/[^\n]+/gu)]
    .find(line => summaryArrow.test(plainLine(line[0]).trim()))?.index : undefined
  const arrowLineEnd = summaryBoundary === undefined ? -1 : text.indexOf('\n', summaryBoundary)
  const afterArrow = arrowLineEnd < 0 ? text.length : arrowLineEnd + 1
  const summaryBody = text.slice(afterArrow).trimStart().split(/\r?\n[ \t]*\r?\n/u, 1)[0]
  const summaryBodyEnd = afterArrow + text.slice(afterArrow).indexOf(summaryBody) + summaryBody.length
  const hasSummaryBlank = summaryBlank.test(plainLine(summaryBody).replace(/\\_/gu, '_'))
  const body = characters(text, true), source = sourceCharacters(pages, passageRefs)
  const { table, pitches, rowBounds, pageRight, visualLines, visualRows } = printedRows([...new Set(source.map(char => char.line))])
  const byLine = new Map<SourceLine, NativeCharacter[]>()
  for (const token of source) {
    const row = byLine.get(token.line)
    if (row) row.push(token)
    else byLine.set(token.line, [token])
  }
  const visual = visualLines.flatMap(line => byLine.get(line) ?? [])
  const rowTokens = visualRows.map(row => row.flatMap(line => byLine.get(line) ?? []))
  const edgeRows = [...rowTokens, ...byLine.values()]
  const columns = tableColumnTokens(rowTokens, table)
  const markdownEnds = new Set([...text.matchAll(/(?<![\\*])(\*{1,2})(?!\*)[^*\n]+?\1(?!\*)/gu)]
    .flatMap(match => Array.from({ length: match[1].length }, (_, i) => match.index + match[0].length - 1 - i)))
  const pageHeights = new Map(pages.map(page => [page.page, page.height]))
  const notice = value.questions.some(question => question.question_type === 'notice' || /안내문/u.test(question.stem))
  const closing = [...text.matchAll(/[^\n]+/gu)].find(match => materialClosing.test(plainLine(match[0]).trim()))?.index
  const edits: { start: number; end: number; text: string }[] = []
  let itemContinuationAt = -1
  let footnoteContinuationAt = -1
  for (let i = 0; i < body.length - 1; i++) {
    const left = body[i], right = body[i + 1], gap = text.slice(left.end, right.start)
    if (!/\r?\n/u.test(gap) || /\n[ \t]*\r?\n/u.test(gap) || !/^\s*$/u.test(gap.replace(inlineMarks, ''))) continue
    const split = text.indexOf('\n', left.end)
    const previousStart = text.lastIndexOf('\n', left.start - 1) + 1
    const previous = text.slice(previousStart, split).trim()
    const nextEnd = text.indexOf('\n', right.start)
    const next = text.slice(split + 1, nextEnd < 0 ? text.length : nextEnd).trim()
    const previousPlain = plainLine(previous).replace(/\\(?=[\\*_[\]])/gu, '')
    const nextPlain = plainLine(next).replace(/\\(?=[\\*_[\]])/gu, '')
    if (summary && (summaryArrow.test(previousPlain) || summaryArrow.test(nextPlain))) {
      edits.push({ start: split, end: split + 1, text: '\n\n' })
      continue
    }
    if (closing !== undefined && previousStart >= closing || materialGreeting.test(previousPlain) || materialClosing.test(nextPlain)
      || /[\t|]/u.test(previous + next)) {
      continue
    }
    let match = matchedBoundary(body, source, i) ?? matchedBoundary(body, visual, i)
    if (!match && markdownEnds.has(left.start)) {
      let closingStart = i
      while (closingStart > 0 && markdownEnds.has(body[closingStart - 1].start)) closingStart--
      const comparable = [...body.slice(0, closingStart), ...body.slice(i + 1)]
      if (closingStart > 0) match = matchedBoundary(comparable, visual, closingStart - 1)
    }
    const fallback = !match || table.has(match[0].line) || table.has(match[1].line)
      ? rowEdgeMatch(previousPlain, nextPlain, edgeRows, pitches, pageHeights, table) : undefined
    const columnMatches = !match || table.has(match[0].line) || table.has(match[1].line)
      ? columns.flatMap(column => {
        const edge = matchedBoundary(body, column, i)
        if (!edge) return []
        const [a, b] = edge.map(token => token.line)
        return a.y >= b.y && a.y - b.y <= (pitches.get(a.page) ?? 0) * 1.3 ? [edge] : []
      }) : []
    const inSummarySentence = hasSummaryBlank && previousStart >= afterArrow && split < summaryBodyEnd
    if (!inSummarySentence && (fallback?.cell || columnMatches.length === 1)) {
      const continuesCell = /^[a-z]/u.test(nextPlain)
        || /(?:\b(?:and|or|from|the|of|to|with)|[&–—-])$/iu.test(previousPlain)
        || /^[^()]+\)/u.test(nextPlain) && !/[.!?]$/u.test(previousPlain)
      if (continuesCell && !materialListStart.test(nextPlain) && !footnoteStart.test(nextPlain) && !materialNoticeField.test(nextPlain)) {
        edits.push({ start: split, end: split + 1, text: ' ' })
      }
      continue
    }
    if (!match && !fallback) continue
    const [nativeLeft, nativeRight] = match ?? [fallback!.left, fallback!.right]
    const a = nativeLeft.line, b = nativeRight.line
    const sameRow = match ? sourceSeparator(nativeLeft, nativeRight) : undefined
    const pitch = pitches.get(a.page)
    const leftBounds = rowBounds.get(a), rightBounds = rowBounds.get(b)
    if (!leftBounds || !rightBounds) continue
    const indent = rightBounds.left - leftBounds.left
    const fullRow = (pageRight.get(a.page) ?? leftBounds.right) - leftBounds.right < 5
    const startsItem = materialListStart.test(previousPlain) || materialNoticeField.test(previousPlain)
      || /^\([A-Z]\)\s+\S/u.test(previousPlain) || notice && footnoteStart.test(previousPlain)
    const itemContinuation = itemContinuationAt === previousStart
    const hangingIndent = indent > 0 && indent < 90 && (startsItem || itemContinuation) && (notice || indent < 25)
    const nextRow = a.page === b.page && a.y > b.y && pitch !== undefined && a.y - b.y <= pitch * 1.35
    // Justified text around a labelled blank can look like multiple cells.
    const summaryWrap = inSummarySentence && nextRow && Math.abs(indent) <= 12
      && Math.abs(leftBounds.right - rightBounds.right) < 4
    if ((table.has(a) || table.has(b)) && !summaryWrap) continue
    const previousHeading = materialBoldHeading.test(previous) || notice && printedHeading(a)
    const nextHeading = materialBoldHeading.test(next) || notice && printedHeading(b)
    const centerShift = Math.abs((leftBounds.left + leftBounds.right - rightBounds.left - rightBounds.right) / 2)
    // Centered consecutive bold rows can be one printed title split to fit the box.
    const titleWrap = notice && nextRow && previousHeading && nextHeading && centerShift < 3
      && Math.abs(indent) >= 6 && !startsItem && !materialListStart.test(nextPlain) && !materialNoticeField.test(nextPlain)
    const emailWrap = wrapsEmail(previousPlain, nextPlain) && (nextRow || sameRow === '')
    const field = (notice || closing !== undefined) && materialNoticeField.test(nextPlain)
    const inlineEmailLabel = nextRow && /^email:/iu.test(nextPlain) && /\b(?:via|by)\s*$/iu.test(previousPlain)
    const headingBoundary = (previousHeading || nextHeading) && !titleWrap
    const noticeAside = notice && nextRow && (startsItem || itemContinuation) && /[.!?]$/u.test(previousPlain)
      && /^\([A-Z][a-z]/u.test(nextPlain)
    if (headingBoundary || noticeAside || structuralStart.test(nextPlain) || field && !inlineEmailLabel
      || materialListStart.test(nextPlain) && !(right.char === '—' && !notice)) {
      // The clipboard can otherwise join a heading whose printed bold is absent from the draft.
      if (noticeAside || notice && headingBoundary && (previousHeading && !materialBoldHeading.test(previous)
        || nextHeading && !materialBoldHeading.test(next))) {
        edits.push({ start: split, end: split + 1, text: '\n\n' })
      }
      continue
    }
    const pageWrap = b.page === a.page + 1 && a.y < 55 && (pageHeights.get(b.page) ?? Infinity) - b.y < 85
      && fullRow && Math.abs(indent) < 6
    const endsIndentedItem = notice && itemContinuation && indent < -4
    const startsCenteredBlock = notice && itemContinuation && indent >= 25 && /[.!?]$/u.test(previousPlain)
    const centeredContinuation = notice && !startsItem && !itemContinuation && indent < -20 && centerShift < 3
    const footnoteWrap = nextRow && (footnoteStart.test(previousPlain) || footnoteLabelAtEnd.test(previousPlain)
      || footnoteContinuationAt === previousStart) && /[가-힣]/u.test(previousPlain)
      && /^[가-힣]/u.test(nextPlain) && Math.abs(leftBounds.right - rightBounds.right) < 3
    const shortNoticeParagraph = notice && !startsItem && !itemContinuation && !fullRow
      && /[.!?][”’"')]*$/u.test(previousPlain) && /^[“‘"'(]*[A-Z]/u.test(nextPlain)
    const continuesRow = ((nextRow && !endsIndentedItem && !startsCenteredBlock && !shortNoticeParagraph
      && (indent >= -20 && indent < 6 || hangingIndent || centeredContinuation)) || pageWrap)
      && /[A-Za-z]/u.test(a.text + b.text) && !/[-\u2010\u2011]/u.test(left.char)
      && (proseStart.test(right.char) || right.char === '_' || right.char === ')' && /[①-⑤❶-❺]$/u.test(previousPlain))
    if (continuesRow && (startsItem || itemContinuation && indent >= -2)) itemContinuationAt = split + 1
    if (footnoteWrap) footnoteContinuationAt = split + 1
    const spacedMarker = a.page === b.page && Math.abs(a.y - b.y) <= .7 && a !== b
      && circles.includes(left.char) && b.x - a.x - a.width >= 0 && b.x - a.x - a.width < 22
    if (sameRow === undefined && !continuesRow && !titleWrap && !emailWrap && !spacedMarker && !footnoteWrap && !summaryWrap) {
      const paragraphGap = a.page === b.page && pitch !== undefined && a.y - b.y > pitch * 1.35
        && a.y - b.y <= pitch * 3 && Math.abs(indent) < 25
      if (paragraphGap || nextRow && (startsCenteredBlock || indent >= 6 && !startsItem && !itemContinuation)) {
        edits.push({ start: split, end: split + 1, text: '\n\n' })
      }
      continue
    }
    const tags = gap.match(inlineMarks)?.join('') ?? ''
    const opening = tags.search(/<[a-z]/iu), position = opening < 0 ? tags.length : opening
    edits.push({ start: left.end, end: right.start, text: tags.slice(0, position) + (emailWrap ? '' : sameRow ?? ' ') + tags.slice(position) })
  }
  let passage = text
  for (const edit of edits.reverse()) passage = passage.slice(0, edit.start) + edit.text + passage.slice(edit.end)
  return { ...prepared, passage }
}

/** Some mappings place the printed summary and its arrow inside the stem. */
export function normalizeBookSummaryStem(question: BookExtraction['questions'][number], pages: SourcePage[], refs: SourceRef[]) {
  if (question.question_type !== 'summary') return question
  const arrow = [...question.stem.matchAll(/[^\n]+/gu)]
    .find(line => summaryArrow.test(plainLine(line[0]).trim()))
  if (!arrow) return question
  const arrowEnd = arrow.index + arrow[0].length
  const prompt = question.stem.slice(0, arrow.index).trimEnd()
  const tail = question.stem.slice(arrowEnd).trimStart()
  const passage = tail ? `↓\n\n${tail}` : '↓'
  const normalized = normalizeBookPassageParagraphs({ passage, translation: '', vocabulary: '', questions: [question] }, pages, refs)
  return { ...question, stem: [prompt, normalized.passage].filter(Boolean).join('\n\n') }
}

// Korean typesetting can wrap within an eojeol. Restore common instruction
// words and particles only when PDF coordinates confirm a physical wrap.
const instructionWords = ['가장', '적절한', '적절하지', '일치하는', '일치하지', '의미하는', '않는', '않은', '것으로']

function instructionSeparator(previous: string, next: string) {
  const withinWord = instructionWords.some(word => [...word].slice(1).some((_, index) => {
    const cut = index + 1
    return previous.endsWith(word.slice(0, cut)) && next.startsWith(word.slice(cut))
  }))
  return withinWord || /\)$/u.test(previous) && /^(?:에|의|은|는|이|가|을|를)(?:\s|[,.?])/u.test(next) ? '' : ' '
}

export function normalizeBookQuestionStem(question: BookExtraction['questions'][number], pages: SourcePage[], refs: SourceRef[]) {
  const { stem } = question
  const promptEnd = [...stem.matchAll(/[^\n]+/gu)].find(line =>
    /(?:[?？]|고르시오\.)\s*(?:\\?\[\s*\d점\\?\])?\s*$/u.test(plainLine(line[0]).trim()))
  if (!promptEnd || !stem.includes('\n')) return normalizeBookSummaryStem(question, pages, refs)
  const end = promptEnd.index + promptEnd[0].length
  const prompt = stem.slice(0, end), tail = stem.slice(end)
  const body = characters(prompt, true), source = sourceCharacters(pages, refs)
  const edits: { start: number; end: number; text: string }[] = []
  for (let i = 0; i + 1 < body.length; i++) {
    const left = body[i], right = body[i + 1]
    const gap = prompt.slice(left.end, right.start)
    if (!/^[ \t]*\r?\n[ \t]*$/u.test(gap.replace(inlineMarks, ''))) continue
    const edge = matchedBoundary(body, source, i)
    if (!edge) continue
    const [a, b] = edge.map(token => token.line)
    const nextRow = a.page === b.page && a.y - b.y > 1
      && a.y - b.y <= Math.max(a.height, b.height, 9) * 2.1 && Math.abs(a.x - b.x) <= 22
    const sameRow = sourceSeparator(...edge)
    if (!nextRow && sameRow === undefined) continue
    const split = prompt.indexOf('\n', left.end)
    const previous = plainLine(prompt.slice(prompt.lastIndexOf('\n', left.start - 1) + 1, split)).trim()
    const nextBreak = prompt.indexOf('\n', right.start)
    const next = plainLine(prompt.slice(split + 1, nextBreak < 0 ? prompt.length : nextBreak)).trim()
    const separator = nextRow ? instructionSeparator(previous, next) : sameRow
    const tags = gap.match(inlineMarks)?.join('') ?? ''
    const opening = tags.search(/<[a-z]/iu), position = opening < 0 ? tags.length : opening
    edits.push({ start: left.end, end: right.start, text: tags.slice(0, position) + separator + tags.slice(position) })
  }
  let normalized = prompt
  for (const edit of edits.reverse()) normalized = normalized.slice(0, edit.start) + edit.text + normalized.slice(edit.end)
  if ((question.question_type === 'insert' || question.question_type === 'order') && tail.trim()) {
    const boxed = normalizeBookPassageParagraphs(
      { passage: tail.trim(), translation: '', vocabulary: '', questions: [] }, pages, refs).passage
    return { ...question, stem: normalized + tail.slice(0, tail.length - tail.trimStart().length) + boxed }
  }
  return normalizeBookSummaryStem({ ...question, stem: normalized + tail }, pages, refs)
}

/** The printed down arrow introduces the summary below the main passage. */
export function placeBookSummaryAfterPassage(value: BookExtraction) {
  const [question] = value.questions
  if (value.questions.length !== 1 || question.question_type !== 'summary' || !value.passage.trim()) return value
  const arrow = [...question.stem.matchAll(/[^\n]+/gu)].find(line => summaryArrow.test(plainLine(line[0]).trim()))
  if (!arrow || value.passage.split('\n').some(line => summaryArrow.test(plainLine(line).trim()))) return value
  const prompt = question.stem.slice(0, arrow.index).trimEnd()
  const summary = question.stem.slice(arrow.index)
  if (!prompt || !summaryBlank.test(plainLine(summary).replace(/\\_/gu, '_'))) return value
  return { ...value, passage: value.passage.trimEnd() + '\n\n' + summary, questions: [{ ...question, stem: prompt }] }
}

/** Final layout pass for an audited source, before validation and fingerprinting. */
export function normalizeAuditedBookLayout(value: BookExtraction, pages: SourcePage[], mapping: {
  passage: SourceRef[]
  questions: { id: string; stem: SourceRef[] }[]
}) {
  const prepared = normalizeBookPassageParagraphs(value, pages, mapping.passage)
  const questions = prepared.questions.map(question => normalizeBookQuestionStem(question, pages,
    mapping.questions.find(mapped => mapped.id === question.key)?.stem ?? []))
  return placeBookSummaryAfterPassage({ ...prepared, questions })
}
