import { describe, expect, it } from 'vitest'
import { copyBlockHtml, copyBlockText, normalizeCopyParagraphs } from '@/lib/material-copy'
import { materialInlinePlain, parseMaterialInline } from '@/lib/material-inline'

describe('clipboard paragraph reflow without source mutation', () => {
  it('joins English column wraps but preserves explicit paragraphs and their punctuation', () => {
    const source = 'The school decided to expand the number of clubs for\nextracurricular activities. This provides students\nwith an opportunity.\n\nAnother paragraph continues\non the next printed line.'
    expect(copyBlockText(source)).toBe('The school decided to expand the number of clubs for extracurricular activities. This provides students with an opportunity.\n\nAnother paragraph continues on the next printed line.')
    expect(copyBlockHtml(source)).toBe('<p>The school decided to expand the number of clubs for extracurricular activities. This provides students with an opportunity.</p><p>Another paragraph continues on the next printed line.</p>')
  })
  it('keeps greeting, signature, options, paragraph labels, headings and footnotes separate', () => {
    const source = 'Dear students,\nI am writing to invite\nyou to our school.\nBest regards,\nAmanda Clark\n(A) First passage continues\non this line.\n(B) Another passage.\n① First option continues\non this line.\n② Second option.\n* resume: 이력서\n** semester: 학기'
    const result = copyBlockText(source)
    expect(result).toContain('Dear students,\nI am writing to invite you to our school.\nBest regards,\nAmanda Clark\n(A)')
    expect(result).toContain('(A) First passage continues on this line.\n(B)')
    expect(result).toContain('① First option continues on this line.\n② Second option.\n* resume: 이력서\n** semester: 학기')
  })
  it('does not guess whether bare Korean boundaries are word breaks or split words', () => {
    for (const source of ['대\n한 요청', '학교\n생활', '제출해\n주기를 권합니다.', '한글\nEnglish']) {
      expect(copyBlockText(source)).toBe(source)
    }
    expect(copyBlockText('학교 \n생활에 참여합니다.')).toBe('학교 생활에 참여합니다.')
  })
  it('preserves printed hyphens rather than deleting a real compound hyphen or inventing a word', () => {
    for (const source of ['well-\nbeing', 'communi-\ncation', 'self-\ncontrol', 'long‐\nterm', 'non‑\ncommercial']) {
      expect(copyBlockText(source)).toBe(source)
    }
    expect(copyBlockText('well-being and non-commercial activities')).toBe('well-being and non-commercial activities')
  })
  it('joins only explicitly discretionary soft-hyphen splits, including within underline markup', () => {
    expect(copyBlockText('communi\u00ad\ncation')).toBe('communication')
    expect(copyBlockHtml('<u>communi\u00ad</u>\n<strong>cation</strong>')).toBe('<p><u>communi</u><strong>cation</strong></p>')
    expect(copyBlockText('communi\u00ad\n\ncation')).toBe('communi\u00ad\n\ncation')
  })
  it('preserves bold, italics and nested underlines across reflow and real paragraph boundaries', () => {
    expect(copyBlockHtml('The **important**\n<u><strong>source words</strong></u> remain *exact*.')).toBe('<p>The <strong>important</strong> <u><strong>source words</strong></u> remain <em>exact</em>.</p>')
    expect(copyBlockHtml('<u>First paragraph.\n\nSecond paragraph.</u>')).toBe('<p><u>First paragraph.</u></p><p><u>Second paragraph.</u></p>')
    expect(copyBlockHtml('<u>한\n글</u>')).toBe('<p><u>한</u><br><u>글</u></p>')
  })
  it('uses indentation and blank lines as explicit paragraphs, never as wrap spaces', () => {
    expect(copyBlockText('A paragraph that continues\nwith more words.\n   A new paragraph begins\nand continues.')).toBe('A paragraph that continues with more words.\n\nA new paragraph begins and continues.')
    expect(copyBlockText('\r\nfirst line\r\ncontinues\r\n\r\nsecond paragraph\r\n')).toBe('first line continues\n\nsecond paragraph')
  })
  it('keeps vocabulary lists, tables and uncertain numbers in their own rows', () => {
    expect(copyBlockText('expand 확대하다\nopportunity 기회\nlook forward to 기대하다', 'list')).toBe('expand 확대하다\nopportunity 기회\nlook forward to 기대하다')
    expect(copyBlockHtml('A\t10\nB\t20')).toBe('<p>A\t10<br>B\t20</p>')
    expect(copyBlockText('20\n27')).toBe('20\n27')
  })
  it('preserves already clean text, blank/underline tokens, ordering and character content', () => {
    const cases = ['A clean passage without printed wraps.', '(A) First.\n(B) Second.', 'An ___ remains\nblank in this sentence.', '◆ 첫 문단\n◆ 둘째 문단', '\\*resume: 이력서\n** semester: 학기']
    for (const source of cases) {
      const result = copyBlockText(source)
      expect(result.replace(/\s/g, '')).toBe(materialInlinePlain(parseMaterialInline(source)).replace(/\s/g, ''))
      expect(normalizeCopyParagraphs(normalizeCopyParagraphs(source))).toBe(normalizeCopyParagraphs(source))
    }
  })
  it('escapes unknown HTML and does not modify the shared original renderer', () => {
    expect(copyBlockHtml('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
    expect(copyBlockHtml('A &amp; B')).toBe('<p>A &amp; B</p>')
    expect(copyBlockText('')).toBe('')
    expect(copyBlockHtml('')).toBe('')
  })
})
