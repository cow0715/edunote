import { describe, expect, it } from 'vitest'
import { materialInlineHtml, materialInlinePlain, parseMaterialInline } from '@/lib/material-inline'
const html = (s:string) => materialInlineHtml(parseMaterialInline(s)), plain = (s:string) => materialInlinePlain(parseMaterialInline(s))
describe('native and legacy material formatting', () => {
  it('keeps legacy bold, italic, underlines and newlines in clipboard output', () => {
    expect(html('**bold** *italic* <u>under</u>\nnext')).toBe('<strong>bold</strong> <em>italic</em> <u>under</u><br>next')
    expect(plain('**bold** *italic* <u>under</u>')).toBe('bold italic under')
  })
  it('preserves nested bold-underlined source words rather than rendering markup as text', () => {
    expect(html('<strong><u>her</u></strong>')).toBe('<strong><u>her</u></strong>')
    expect(html('**<u>her</u>**')).toBe('<strong><u>her</u></strong>')
    expect(plain('<u><strong>her</strong></u>')).toBe('her')
  })
  it('restores escaped PDF punctuation and footnotes without creating formatting', () => {
    expect(plain('\\*resume: 이력서 \\[A\\] a\\_b')).toBe('*resume: 이력서 [A] a_b')
    expect(html('* resume: 이력서')).toBe('* resume: 이력서')
    expect(html('** resume: 이력서')).toBe('** resume: 이력서')
  })
  it('decodes native entities once and never executes unknown HTML', () => {
    expect(plain('A &amp; B &lt; C')).toBe('A & B < C')
    expect(html('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html('<img src=x onerror=alert(1)>')).toContain('&lt;img')
    expect(plain('&amp;lt;')).toBe('&lt;')
  })
  it('keeps unclosed markup literal and bounds recursive nesting', () => {
    expect(plain('<u>open')).toBe('<u>open')
    expect(() => plain('<u>'.repeat(50)+'x'+'</u>'.repeat(50))).not.toThrow()
  })
})
