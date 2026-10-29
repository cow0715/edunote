import { joinBankNumberedContent } from './bank-numbered-text'
import { normalizeCopyParagraphs } from './material-copy'

/** Reflow prose for reading without touching stored PDF text or verification hashes.
 * Keep tabular/aligned blocks verbatim: their whitespace carries structure. */
export function readablePassage(text: string, stored = false): string {
  if (stored) return text
  return joinBankNumberedContent(text).split(/(\n[ \t]*\n)/).map((block) => {
    if (/^\n/.test(block) || /[|\t]|\S[ ]{2,}\S/.test(block)) return block
    return normalizeCopyParagraphs(block)
  }).join('')
}
