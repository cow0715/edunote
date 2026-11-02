import { joinBankNumberedContent } from './bank-numbered-text'
import { materialInlineHtml, materialInlinePlain, parseMaterialInline, type MaterialInline } from './material-inline'

type CopyMode = 'prose' | 'list'
const hangul = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/
const hardHyphen = /[-\u2010\u2011]$/
const blockStart = /^(?:[①-⑳ⓐ-ⓩ㉠-㉻•●○◆■□▶▪]|\([A-Za-z]\)|\[[A-Za-z]\]|\d+[.)]\s|[-*＊]{1,3}\s*\S|\[(?:해석|풀이|출제의도|어휘|AI[^\]]*)\]|(?:From|To|Date|Subject):)/
const salutation = /^(?:Dear\b.*|(?:Hi|Hello)\b.*[,!]|(?:Best|Warm|Kind) regards[,]?|Sincerely[,]?|Yours(?: sincerely| faithfully| truly)?[,]?|Regards[,]?|.*(?:님께|드림|올림))$/i
const heading = /^(?:\([A-Za-z]\)|\[[A-Za-z]\]|[①-⑳]|출제의도|해석|풀이|어휘|WORDS\s*&\s*PHRASES|Words and Phrases|[_＿]{2,})$/i

/** Clipboard only. Stored source/proofs and on-screen rendering are deliberately untouched.
 * Without PDF coordinates, a bare Hangul boundary or a printed hyphen cannot prove
 * whether a word was split. Keep those breaks instead of guessing a new word. */
export function normalizeCopyParagraphs(text: string, mode: CopyMode = 'prose'): string {
  const source = joinBankNumberedContent(text)
  const raw = source.split('\n')
  const plain = materialInlinePlain(parseMaterialInline(source)).split('\n')
  const indents = raw.filter((line) => line.trim()).map((line) => line.match(/^[ \t\u3000]*/u)![0].length)
  const baseIndent = indents.length ? indents.reduce((min, value) => Math.min(min, value), Infinity) : 0
  const output: string[] = []
  let prior = -1, blank = false
  for (let i = 0; i < raw.length; i++) {
    if (!raw[i].trim()) { if (prior >= 0) blank = true; continue }
    if (prior >= 0) {
      const left = (plain[prior] ?? raw[prior]).trim(), right = (plain[i] ?? raw[i]).trim()
      const indent = raw[i].match(/^[ \t\u3000]*/u)![0].length
      const explicitParagraph = blank || indent > baseIndent + 1
      let separator = '\n'
      if (explicitParagraph) separator = '\n\n'
      else if (mode !== 'list' && !blockStart.test(right) && !heading.test(left) && !salutation.test(left) && !salutation.test(right)
        && !/[\t|]/.test(raw[prior] + raw[i])) {
        const end = left.at(-1) ?? '', start = right[0] ?? ''
        if (end === '\u00ad' && /[A-Za-z]/.test(left.at(-2) ?? '') && /^[a-z]/.test(right)) {
          // U+00AD explicitly denotes a discretionary break; ASCII '-' does not.
          output[output.length - 1] = output.at(-1)!.replace(/\u00ad(?=(?:<\/[^>]+>|\*{1,2})*$)/u, '')
          separator = ''
        } else if (!hardHyphen.test(left) && !(hangul.test(end) || hangul.test(start))
          && !(/\d/.test(end) && /\d/.test(start))
          && !(/[.!?。！？][”’"')\]]*$/.test(left) && /^[“‘"'(]*[A-Z]/.test(right))
          && !(/^[A-Z][A-Za-z '&-]{0,35}$/.test(left) && /^[A-Z]/.test(right))) {
          separator = ' '
        } else if (!hardHyphen.test(left) && (hangul.test(end) || hangul.test(start)) && /[ \t]$/.test(raw[prior])) {
          // An actual trailing source space supplies a word boundary. No space is invented.
          separator = ' '
        }
      }
      output.push(separator)
    }
    output.push(raw[i].trim())
    prior = i; blank = false
  }
  return output.join('')
}

export function copyBlockText(text: string, mode: CopyMode = 'prose') {
  return materialInlinePlain(parseMaterialInline(normalizeCopyParagraphs(text, mode)))
}

/** Split real paragraphs while reopening formatting that spans a paragraph boundary.
 * A remaining ambiguous/structural single break stays a <br>, not an invented paragraph. */
export function copyBlockHtml(text: string, mode: CopyMode = 'prose') {
  const paragraphs: MaterialInline[][] = [[]]
  let pendingBreaks = 0
  function visit(nodes: MaterialInline[], marks: ('bold' | 'italic' | 'underline')[] = []) {
    for (const node of nodes) {
      if (node.kind !== 'text') { visit(node.children, [...marks, node.kind]); continue }
      for (const part of node.text.split(/(\n+)/)) {
        if (!part) continue
        if (part[0] === '\n') { pendingBreaks += part.length; continue }
        if (pendingBreaks >= 2) paragraphs.push([])
        else if (pendingBreaks) paragraphs.at(-1)!.push({ kind: 'text', text: '\n' })
        pendingBreaks = 0
        let value: MaterialInline = { kind: 'text', text: part }
        for (let i = marks.length - 1; i >= 0; i--) value = { kind: marks[i], children: [value] }
        paragraphs.at(-1)!.push(value)
      }
    }
  }
  visit(parseMaterialInline(normalizeCopyParagraphs(text, mode)))
  return paragraphs.filter((p) => p.length).map((p) => `<p>${materialInlineHtml(p)}</p>`).join('')
}
