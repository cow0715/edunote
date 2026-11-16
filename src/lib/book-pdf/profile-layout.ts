import type { SourceLine, SourcePage } from './source-map'
import type { BookUnitManifest } from './types'

const circled = '①②③④⑤'
const filled = '❶❷❸❹❺'
const marker = (char: string) => circled[filled.indexOf(char)] ?? char

/** The source must show five positions with exactly one adjacent repeated number. */
export function bookPrintedChoiceIssue(pages: SourcePage[], unit: BookUnitManifest) {
  if (unit.questions.length !== 1 || unit.visual_required) return null
  const text = pages.flatMap(page => page.lines.filter(line => line.x < page.width / 2)
    .sort((a, b) => b.y - a.y || a.x - b.x).map(line => line.text))
  const actual = text.flatMap(line => [...line.matchAll(/[①②③④⑤❶❷❸❹❺]/gu)].map(match => marker(match[0])))
  const mismatch = actual.flatMap((char, i) => char === circled[i] ? [] : [i])
  if (actual.length !== 5 || mismatch.length !== 1) return null
  const [i] = mismatch
  if (actual[i] !== actual[i - 1] && actual[i] !== actual[i + 1]) return null
  return `원문 선지 번호 중복으로 보류합니다 (인쇄 순서 ${actual.join(' ')}).`
}

export function findBookInsertionParts(pages: SourcePage[], prompt: SourceLine[], content: SourceLine[]) {
  const page = pages.find(p => p.page === prompt.at(-1)?.page)
  if (!page || !content.length || content.some(line => line.page !== page.page)) return null
  const boxes = (page.boxes ?? []).filter(box => box.right <= page.width / 2
    && box.top < prompt.at(-1)!.y && box.right - box.left >= page.width * .3)
  const candidates = boxes.map(box => ({ box, lines: content.filter(line =>
    line.x >= box.left - 2 && line.x + line.width <= box.right + 3 && line.y > box.bottom && line.y < box.top) }))
    .filter(candidate => candidate.lines.length)
    .sort((a, b) => b.box.top - a.box.top)
  if (candidates.length !== 2) return null
  const [given, body] = candidates
  if (given.box.bottom <= body.box.top || given.lines.length + body.lines.length !== content.length
    || content[0] !== given.lines[0] || Math.abs(given.box.left - body.box.left) > 3
    || Math.abs(given.box.right - body.box.right) > 3) return null
  const sentence = given.lines.map(line => line.text).join(' ')
  const passage = body.lines.map(line => line.text).join('\n')
  const locations = [...passage.matchAll(/\(\s*([①②③④⑤❶❷❸❹❺])\s*\)/gu)].map(match => marker(match[1])).join('')
  if (!/[A-Za-z]{2}/u.test(sentence) || /[①②③④⑤❶❷❸❹❺]/u.test(sentence)
    || locations !== circled || (passage.match(/[①②③④⑤❶❷❸❹❺]/gu)?.length ?? 0) !== 5) return null
  return { sentence: given.lines, passage: body.lines }
}
