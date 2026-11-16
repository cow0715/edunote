/** Restricted inline markup shared by native PDF text, legacy Markdown and
 * clipboard output. Unknown HTML is always literal text, never executable. */
export type MaterialInline = { kind: 'text'; text: string } | { kind: 'bold' | 'italic' | 'underline'; children: MaterialInline[] }

/** Older imports print glossary labels as *word: or * word:. */
export function protectMaterialFootnotes(text: string) {
  return text.replace(/(^|\s)(\*{1,3})(?=[ \t]*[\p{L}\p{N}][^*:\r\n<>]{0,60}[:：])/gu,
    (label, space: string, stars: string, offset: number) => {
      const start = offset + space.length + stars.length
      if (!/\s/.test(text[start]) && closingMarker(text, stars, start) >= 0) return label
      return space + '\\*'.repeat(stars.length)
    })
}

export function normalizeMaterialLineBreaks(text: string) {
  return text.replace(/(\\+)\r?\n/g, (_, slashes: string) =>
    slashes.slice(0, slashes.length - slashes.length % 2) + '\n')
}

function closingMarker(text: string, marker: string, start: number) {
  for (let i = start; i < text.length && text[i] !== '\n'; i++) {
    if (text[i] === '\\') { i++; continue }
    if (text[i] !== '*') continue
    const run = text.slice(i).match(/^\*+/)![0]
    if (i > start && run === marker && !/\s/.test(text[i - 1])) return i
    i += run.length - 1
  }
  return -1
}

export function parseMaterialInline(text: string, depth = 0): MaterialInline[] {
  if (depth >= 20) return [{ kind: 'text', text }]
  if (depth === 0) text = normalizeMaterialLineBreaks(protectMaterialFootnotes(text))
  const nodes: MaterialInline[] = [], lastClosing = new Map<string, number>()
  const append = (value: string) => {
    const prior = nodes.at(-1)
    if (prior?.kind === 'text') prior.text += value
    else nodes.push({ kind: 'text', text: value })
  }
  const tags = [['<strong>', '</strong>', 'bold'], ['<b>', '</b>', 'bold'], ['<em>', '</em>', 'italic'], ['<i>', '</i>', 'italic'], ['<u>', '</u>', 'underline']] as const
  for (const [, close] of tags) lastClosing.set(close, text.lastIndexOf(close))
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(text[i + 1] ?? '')) { append(text[i + 1]); i += 2; continue }
    if (text[i] === '&') {
      const entity = text.slice(i).match(/^&(amp|lt|gt|quot|#39);/)
      if (entity) { append(({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity[1]]!); i += entity[0].length; continue }
    }
    const tag = tags.find(([open, close]) => text.startsWith(open, i) && lastClosing.get(close)! >= i + open.length)
    if (tag) {
      const [open, close, kind] = tag, end = text.indexOf(close, i + open.length)
      nodes.push({ kind, children: parseMaterialInline(text.slice(i + open.length, end), depth + 1) }); i = end + close.length; continue
    }
    const marker = text[i] === '*' ? text.slice(i).match(/^\*+/)![0] : null
    if (marker) {
      const start = i + marker.length
      if (marker.length <= 3 && text[start] && !/\s/.test(text[start])) {
        const end = closingMarker(text, marker, start)
        if (end >= 0) {
          const children = parseMaterialInline(text.slice(start, end), depth + 1)
          nodes.push(marker === '***' ? { kind: 'bold', children: [{ kind: 'italic', children }] }
            : { kind: marker === '**' ? 'bold' : 'italic', children })
          i = end + marker.length
          continue
        }
      }
      append(marker)
      i = start
      continue
    }
    append(text[i]); i++
  }
  return nodes
}
export function materialInlinePlain(nodes: MaterialInline[]): string {
  return nodes.map((n) => n.kind === 'text' ? n.text : materialInlinePlain(n.children)).join('')
}
export function materialInlineHtml(nodes: MaterialInline[]): string {
  return nodes.map((n) => {
    if (n.kind === 'text') return n.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>')
    const tag = n.kind === 'bold' ? 'strong' : n.kind === 'italic' ? 'em' : 'u'
    return `<${tag}>${materialInlineHtml(n.children)}</${tag}>`
  }).join('')
}
