/** Restricted inline markup shared by native PDF text, legacy Markdown and
 * clipboard output. Unknown HTML is always literal text, never executable. */
export type MaterialInline = { kind: 'text'; text: string } | { kind: 'bold' | 'italic' | 'underline'; children: MaterialInline[] }
export function parseMaterialInline(text: string, depth = 0): MaterialInline[] {
  if (depth >= 20) return [{ kind: 'text', text }]
  const nodes: MaterialInline[] = [], lastClosing = new Map<string, number>()
  const append = (value: string) => {
    const prior = nodes.at(-1)
    if (prior?.kind === 'text') prior.text += value
    else nodes.push({ kind: 'text', text: value })
  }
  const tags = [['<strong>', '</strong>', 'bold'], ['<b>', '</b>', 'bold'], ['<em>', '</em>', 'italic'], ['<i>', '</i>', 'italic'], ['<u>', '</u>', 'underline']] as const
  for (const [, close] of tags) lastClosing.set(close, text.lastIndexOf(close))
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && /[\\*_\[\]]/.test(text[i + 1] ?? '')) { append(text[i + 1]); i += 2; continue }
    if (text[i] === '&') {
      const entity = text.slice(i).match(/^&(amp|lt|gt|quot|#39);/)
      if (entity) { append(({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity[1]]!); i += entity[0].length; continue }
    }
    const tag = tags.find(([open, close]) => text.startsWith(open, i) && lastClosing.get(close)! >= i + open.length)
    if (tag) {
      const [open, close, kind] = tag, end = text.indexOf(close, i + open.length)
      nodes.push({ kind, children: parseMaterialInline(text.slice(i + open.length, end), depth + 1) }); i = end + close.length; continue
    }
    const marker = text.startsWith('**', i) ? '**' : text[i] === '*' ? '*' : null
    if (marker && text[i + marker.length] && !/\s|\*/.test(text[i + marker.length])) {
      const end = text.indexOf(marker, i + marker.length)
      if (end > i + marker.length && !/\s/.test(text[end - 1]) && !text.slice(i + marker.length, end).includes('\n')) {
        nodes.push({ kind: marker === '**' ? 'bold' : 'italic', children: parseMaterialInline(text.slice(i + marker.length, end), depth + 1) }); i = end + marker.length; continue
      }
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
