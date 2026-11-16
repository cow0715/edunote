import { applyBookChoiceRepair, type BookChoiceRepair } from './printed-choice-source'
import { bookPrintedChoiceIssue } from './profile-layout'
import { bookUnitProfile, mapBookProfile } from './profiles'
import { findBookSourceLabels } from './source-label'
import type { SourceLine, SourceMap, SourcePage } from './source-map'
import { BOOK_PDFIUM_SOURCE } from './source-mode'
import type { BookUnitManifest } from './types'

const numbers = '①②③④⑤'
const glyph = (line: SourceLine) => line.text.trim()
const isMarker = (line: SourceLine) => /^[①②③④⑤❶❷❸❹❺]$/u.test(glyph(line))
const ordinal = (line: SourceLine) => numbers.indexOf(glyph(line)) + 1 || '❶❷❸❹❺'.indexOf(glyph(line)) + 1
const sameRow = (a: SourceLine, b: SourceLine) => a.page === b.page && Math.abs(a.y - b.y) < 1
const atMargin = (line: SourceLine, x: number) => Math.abs(line.x - x) < 2

function followingText(lines: SourceLine[], marker: SourceLine) {
  const next = lines[lines.indexOf(marker) + 1]
  return next && sameRow(marker, next) && next.x > marker.x && !isMarker(next) ? next : undefined
}

function underlinedWord(lines: SourceLine[], marker: SourceLine) {
  const next = lines[lines.indexOf(marker) + 1]
  if (!next || next.page !== marker.page || marker.y - next.y > 24 || isMarker(next)) return ''
  const first = next.text.match(/^\s*([A-Za-z]+)\b/u)
  if (!first) return ''
  const start = first[0].length - first[1].length
  return next.marks.some(m => m.underline && m.start <= start && m.end >= first[0].length) ? first[1] : ''
}

type ChoiceCheck = { status: 'none' } | { status: 'hold'; reason: string }
  | { status: 'repair'; repair: BookChoiceRepair; mapping: SourceMap }

/** A repair is bound to one glyph and requires independent evidence on the answer side. */
export function checkBookPrintedChoices(pages: SourcePage[], unit: BookUnitManifest): ChoiceCheck {
  if (unit.visual_required) return { status: 'none' }
  const left: SourceLine[] = [], right: SourceLine[] = []
  for (const page of pages) {
    for (const line of [...page.lines].sort((a, b) => b.y - a.y || a.x - b.x)) {
      if (line.y < 32 || line.y > page.height - 30 || line.x >= page.width * .95) continue
      const column = line.x < page.width / 2 ? left : right
      column.push(line)
    }
  }
  const blocks: SourceLine[][] = [[]]
  for (const line of left) {
    if (findBookSourceLabels(line.text).length) blocks.push([])
    else blocks.at(-1)!.push(line)
  }
  const candidates = blocks.map(block => block.filter(isMarker))
    .filter(markers => new Set(markers.map(ordinal)).size < markers.length)
  const legacyIssue = bookPrintedChoiceIssue(pages, unit)
  if (!candidates.length && !legacyIssue) return { status: 'none' }
  const [markers] = candidates
  const hold: ChoiceCheck = { status: 'hold', reason: `원문 선지 번호가 중복되어 보류합니다. 인쇄 순서·정답·해설로 교정할 번호를 확정하지 못했습니다.${markers ? ` (인쇄 순서 ${markers.map(glyph).join(' ')})` : ''}` }
  if (unit.questions.length !== 1 || pages.length !== 1 || pages[0].issues.length || candidates.length !== 1 || markers.length !== 5) return hold
  const [question] = unit.questions
  const answer = question.printed_answer
  const positions = markers.map(ordinal)
  const mismatches = positions.flatMap((number, i) => number === i + 1 ? [] : [i])
  if (mismatches.length !== 1 || new Set(positions).size !== 4) return hold
  const [position] = mismatches, target = markers[position]
  const duplicated = positions[position]
  if (Math.abs(duplicated - (position + 1)) !== 1 || !answer || !numbers[answer - 1]
    || answer === duplicated || answer === position + 1) return hold

  const answerHeaders = right.filter(line => /^\[\s*정답\s*\]$/u.test(glyph(line)))
  const solutionHeaders = right.filter(line => /^\[\s*(?:해설|풀이)\s*\]$/u.test(glyph(line)))
  if (answerHeaders.length !== 1 || solutionHeaders.length !== 1) return hold
  const [answerHeader] = answerHeaders, [solutionHeader] = solutionHeaders
  const headerIndex = right.indexOf(answerHeader)
  const heading = right[headerIndex - 1]
  if (!heading || !(findBookSourceLabels(heading.text).some(label => label.ref.key === question.key)
    || new RegExp(`^(?:Exercise\\s+)?0*${question.number}$`, 'iu').test(glyph(heading)))) return hold
  const printed = right[headerIndex + 1]
  if (!printed || !sameRow(answerHeader, printed) || printed.x <= answerHeader.x
    || ![numbers[answer - 1], String(answer)].includes(glyph(printed)) || right.indexOf(printed) >= right.indexOf(solutionHeader)) return hold
  const solutionStart = right.indexOf(solutionHeader) + 1
  const nextHeader = right.findIndex((line, i) => i >= solutionStart && /^\[\s*(?:어휘|정답|해석|소재|해설|풀이)\s*\]$/u.test(glyph(line)))
  const solution = right.slice(solutionStart, nextHeader < 0 ? undefined : nextHeader)
  const citations = solution.filter(isMarker)
  const answerCitations = citations.filter(line => ordinal(line) === answer)
  if (answerCitations.length !== 1) return hold
  const answerExplanation = followingText(solution, answerCitations[0])
  if (!answerExplanation) return hold

  const listed = markers.every((line, i) => atMargin(line, markers[0].x) && (!i || markers[i - 1].y - line.y > 2)
    && !left.some(before => sameRow(before, line) && before.x < line.x)
    && /[\p{L}]{2}/u.test(followingText(left, line)?.text ?? ''))
  const words = listed ? [] : markers.map(line => underlinedWord(left, line))
  if (listed) {
    const distractors = citations.filter(line => atMargin(line, solutionHeader.x))
    const expected = [...numbers].filter((_, i) => i + 1 !== answer).join('')
    if (distractors.map(line => numbers[ordinal(line) - 1]).join('') !== expected || citations.length !== 5
      || distractors.some(line => !/[가-힣]{2}/u.test(followingText(solution, line)?.text ?? ''))) return hold
  } else {
    const citedWord = answerExplanation.text.match(/^\s*(?:의\s*)?[‘“'"(]?([A-Za-z]+)\b/u)?.[1]
    if (citations.length !== 1 || words.some(word => !word) || new Set(words.map(word => word.toLowerCase())).size !== 5
      || citedWord?.toLowerCase() !== words[answer - 1].toLowerCase()) return hold
  }

  const repair: BookChoiceRepair = { page: target.page, line: target.id, offset: target.text.indexOf(glyph(target)),
    from: glyph(target), to: numbers[position], position: position + 1, answer, field: listed ? 'choice' : 'passage' }
  const profileUnit = bookUnitProfile(unit) ? unit : { ...unit, questions: [{ ...question, source_kind: 'chapter' as const }] }
  const { mapping } = mapBookProfile(applyBookChoiceRepair(pages, repair), profileUnit, BOOK_PDFIUM_SOURCE)
  const group = mapping?.groups[0], mapped = group?.questions[0]
  const refs = listed ? mapped?.choices?.[position] : !mapped?.choices ? group?.passage : undefined
  const owns = (id: number, offset = 0) => refs?.some(ref => ref.s === id && ref.e === id && (ref.a ?? 0) <= offset && (ref.b ?? Infinity) > offset)
  if (!mapping || !owns(target.id, repair.offset) || !mapped?.answer.some(ref => ref.s === printed.id)
    || citations.some(line => !mapped.solution.some(ref => ref.s === line.id))) return hold
  return { status: 'repair', repair, mapping }
}
