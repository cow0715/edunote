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
  it('reads legacy and escaped footnote labels alongside explicit and legacy marks', () => {
    expect(html('*patron: 후원자 **deictic: 지시적인 ***wildfowl: 엽조')).toBe('*patron: 후원자 **deictic: 지시적인 ***wildfowl: 엽조')
    expect(html('\\*patron: 후원자 \\*\\*deictic: 지시적인 \\*\\*\\*wildfowl: 엽조')).toBe('*patron: 후원자 **deictic: 지시적인 ***wildfowl: 엽조')
    expect(html('***<u>겹침</u>*** <strong>굵게</strong> <em>기울임</em>')).toBe('<strong><em><u>겹침</u></em></strong> <strong>굵게</strong> <em>기울임</em>')
    expect(html('**문장 \\*별표**')).toBe('<strong>문장 *별표</strong>')
    expect(html('**제목: 실제 굵기**')).toBe('<strong>제목: 실제 굵기</strong>')
  })
  it('decodes legacy Markdown hard breaks and escaped punctuation without losing literal backslashes', () => {
    expect(plain('앞줄\\\n\\*word: \\~을 뜻함')).toBe('앞줄\n*word: ~을 뜻함')
    expect(html('<em>앞줄\n뒷줄</em>')).toBe('<em>앞줄<br>뒷줄</em>')
    expect(plain('경로 C:\\Users\\\\\n다음 줄')).toBe('경로 C:\\Users\\\n다음 줄')
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
