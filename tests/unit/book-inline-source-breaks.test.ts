import { describe, expect, it } from 'vitest'
import { normalizeAuditedBookLayout, normalizeBookPassageParagraphs, normalizeBookQuestionStem, normalizeBookSummaryStem, placeBookSummaryAfterPassage, restoreInlineSourceBreaks } from '@/lib/book-pdf/inline-source-breaks'
import { buildQuestionCopyHtml, buildQuestionCopyText } from '@/lib/exam-bank-copy'
import { copyBlockText } from '@/lib/material-copy'
import { buildSourceLines } from '@/lib/book-pdf/layout-source'
import type { SourcePage } from '@/lib/book-pdf/source-map'
import type { BookExtraction } from '@/lib/book-pdf/types'

const first = 'I lead a discussion about how'
const second = 'whatever their teachers ask matters'
const third = 'copying everything is a wasteful endeavor.'
const lines = [first + ' ', '④', ' ' + second + ' ⑤', third]
const source: SourcePage[] = [{ page: 53, width: 595, height: 841, issues: [],
  lines: lines.map((text, i) => ({
    id: i+1, page: 53, x: [53, 200, 209, 53][i], y: [486, 486, 486, 471][i],
    width: [147, 9, 70, 200][i], height: 10, text, marks: [],
  })),
}]
const refs = [{ s: 1, e: 4 }]
const draft = (passage: string): BookExtraction => ({ passage, translation: '', vocabulary: '', questions: [
  { key: '11:exercise:1', question_type: 'grammar', choices: [], answer: 3, stem: '발문?', solution: '', intent: '' },
] })

describe('stored inline marker breaks from PDF coordinates', () => {
  it('joins a split marker on the same printed row and keeps a real line break', () => {
    const input = draft(first + '\n④\n <u>' + second + '</u> ⑤\n' + third)
    const result = restoreInlineSourceBreaks(input, source, refs)
    expect(result.passage).toBe(first + ' ④ <u>' + second + '</u> ⑤\n' + third)
    expect(restoreInlineSourceBreaks(result, source, refs)).toEqual(result)
    expect(input.passage).toContain('\n④\n')
  })
  it('keeps inline text assembled across PDF rows and ignores a different column', () => {
    const input = draft(first + ' ④ ' + second + ' ⑤ ' + third)
    expect(restoreInlineSourceBreaks(input, source, refs)).toEqual(input)
    const wideGap = structuredClone(source)
    wideGap[0].lines[1].x += 100
    const split = draft(first + '\n④\n' + second + ' ⑤\n' + third)
    expect(restoreInlineSourceBreaks(split, wideGap, refs)).toEqual(split)
  })
  it('leaves ordinary choices and passages with insufficient or ambiguous source evidence alone', () => {
    const input = draft(first + '\n④\n' + second + ' ⑤\n' + third)
    expect(restoreInlineSourceBreaks(input, source, [{ s: 2, e: 2 }])).toEqual(input)
    const repeated = structuredClone(source)
    repeated[0].lines.push(...repeated[0].lines.map(line => ({ ...line, id: line.id + 4, y: line.y - 100 })))
    expect(restoreInlineSourceBreaks(input, repeated, [{ s: 1, e: 8 }])).toEqual(input)
    input.questions[0].choices = ['① 하나', '② 둘', '③ 셋', '④ 넷', '⑤ 다섯']
    expect(restoreInlineSourceBreaks(input, source, refs)).toEqual(input)
  })
})

describe('stored passage paragraphs', () => {
  it('retains the summary arrow and folds the summary when it is stored in the stem', () => {
    const [question] = draft('').questions
    const prompt = '다음 글의 내용을 한 문장으로 요약하시오.'
    const first = 'A new study found that ____(A)____ can'
    const second = 'change how people choose ____(B)____.'
    const page = { ...source[0], lines: [prompt, '\uF000', first, second, '(A) (B)'].map((text, i) => ({
      ...source[0].lines[0], id: i + 1, text, x: 53, y: 510 - i * 15, width: 228,
    })) }
    const stem = [prompt, '\uF000', first, second, '(A) (B)'].join('\n')
    const normalized = normalizeBookSummaryStem({ ...question, question_type: 'summary', stem },
      [page], [{ s: 1, e: page.lines.length }])
    expect(normalized.stem).toBe(`${prompt}\n\n↓\n\n${first} ${second}\n(A) (B)`)
    expect(copyBlockText(normalized.stem)).toContain('\n\n↓\n\n')
  })

  it('joins a Korean prompt at a PDF wrap and preserves the separate insertion box', () => {
    const rows = ['글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절', '한 곳은?',
      'These activities require a substantial amount of', 'coordination between several independent groups.']
    const page = { ...source[0], lines: rows.map((text, i) => ({
      ...source[0].lines[0], id: i + 1, text, x: 53, y: [510, 495, 463, 448][i], width: 228,
    })) }
    const [question] = draft('').questions
    const input = { ...question, question_type: 'insert' as const,
      stem: `<strong>${rows[0]}\n${rows[1]}</strong>\n\n${rows.slice(2).join('\n')}` }
    expect(normalizeBookQuestionStem(input, [page], [{ s: 1, e: 4 }]).stem)
      .toBe(`<strong>${rows[0]}${rows[1]}</strong>\n\n${rows.slice(2).join(' ')}`)
    expect(normalizeBookQuestionStem(input, [page], [])).toEqual(input)
  })

  it('keeps a Korean word boundary and does not fold a separate instruction block', () => {
    const rows = ['Gear Up for Good에 관한 다음 안내문의 내용과 일치하는', '것은?']
    const page = { ...source[0], lines: rows.map((text, i) => ({
      ...source[0].lines[0], id: i + 1, text, x: 53, y: 510 - i * 15, width: 228,
    })) }
    const [question] = draft('').questions
    const input = { ...question, stem: rows.join('\n') }
    expect(normalizeBookQuestionStem(input, [page], [{ s: 1, e: 2 }]).stem).toBe(rows.join(' '))
    const separated = { ...input, stem: rows.join('\n\n') }
    expect(normalizeBookQuestionStem(separated, [page], [{ s: 1, e: 2 }])).toEqual(separated)
  })

  it('puts the passage ahead of the arrow and summary in both clipboard formats', () => {
    const value = draft('Main passage.\n\nSecond paragraph.')
    value.questions[0] = { ...value.questions[0], question_type: 'summary',
      stem: '가장 적절한 것은?\n\n↓\n\nThe summary ____(A)____ and ____(B)____.\n(A) (B)' }
    const result = normalizeAuditedBookLayout(value, [], { passage: [], questions: [] })
    const question = { question_text: result.questions[0].stem, passage: result.passage,
      choices: [], answer: null }
    expect(question.question_text).toBe('가장 적절한 것은?')
    expect(buildQuestionCopyText(question, '교재')).toContain('Main passage.\n\nSecond paragraph.\n\n↓\n\nThe summary')
    expect(buildQuestionCopyHtml(question, '교재')).toContain('<p>Main passage.</p><p>Second paragraph.</p><p>↓</p><p>The summary')
    expect(placeBookSummaryAfterPassage(result)).toEqual(result)
  })
  it('keeps a field-like word inline in prose and folds a three-fragment row after a first-line indent', () => {
    const fragments = [
      ['Across Europe, communities have changed over', 63, 480, 218],
      ['time: voters', 53, 465, 68], ['choose', 154, 465, 36], ['representatives', 218, 465, 63],
      ['to act on behalf of their local communities.', 53, 450, 228],
    ] as const
    const page = { ...source[0], lines: fragments.map(([text, x, y, width], i) => ({
      ...source[0].lines[0], id: i + 1, text, x, y, width,
    })) }
    const input = draft('Across Europe, communities have changed over\ntime: voters choose representatives\nto act on behalf of their local communities.')
    expect(normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: fragments.length }]).passage)
      .toBe(input.passage.replaceAll('\n', ' '))
  })

  it('keeps following a right-aligned footnote after the row containing its label', () => {
    const rows = [
      ['*term: 길게 이어지는 설명을', 80, 201],
      ['다음 줄에서도 덧붙이는', 90, 191],
      ['것)', 270, 11],
      ['**other: 별도 각주입니다', 110, 171],
    ] as const
    const page = { ...source[0], lines: rows.map(([text, x, width], i) => ({
      ...source[0].lines[0], id: i + 1, text, x, width, y: 450 - i * 12,
    })) }
    const input = draft(rows.map(([text]) => text.replaceAll('*', '\\*')).join('\n'))
    const expected = '\\*term: 길게 이어지는 설명을 다음 줄에서도 덧붙이는 것)\n\\*\\*other: 별도 각주입니다'
    expect(normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: rows.length }]).passage).toBe(expected)
  })

  it('recognizes a summary sentence before the labelled blank reaches the page edge', () => {
    const fragments = [
      ['A short passage introduces how the experiment works.', 53, 510, 228],
      ['↓', 163, 491, 10],
      ['Babies', 63, 475, 32], ['actively', 121, 475, 35], ['conduct', 176, 475, 40], ['experiments', 228, 475, 53],
      ['to understand what is happening in their environment', 53, 459, 228],
      ['and react to ____(A)____ signals from adults.', 53, 443, 228],
    ] as const
    const page = { ...source[0], lines: fragments.map(([text, x, y, width], i) => ({
      ...source[0].lines[0], id: i + 1, text, x, y, width,
    })) }
    const opening = 'A short passage introduces how the experiment works.'
    const sentence = ['Babies actively conduct experiments', fragments[6][0], fragments[7][0]]
    const input = draft([opening, '↓', ...sentence].join('\n'))
    input.questions[0].question_type = 'summary'
    const result = normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: fragments.length }])
    expect(result.passage).toBe([opening, '↓', sentence.join(' ')].join('\n\n'))
  })
  it('folds a right-aligned footnote continuation and preserves separate footnotes', () => {
    const lines = ['This example introduces a term.', '*term: 설명이 길어서 다음 줄까지', '이어지는 부분', '**other: 새 각주']
    const page = { ...source[0], lines: lines.map((text, i) => ({
      ...source[0].lines[0], id: i + 1, text, x: [53, 90, 210, 140][i],
      y: 450 - i * 12, width: [228, 191, 71, 141][i],
    })) }
    const input = draft(lines.join('\n').replaceAll('*', '\\*'))
    const result = normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: 4 }])
    expect(result.passage).toBe(input.passage.replace('줄까지\n이어지는', '줄까지 이어지는'))
  })

  it('joins a wrapped glossary definition without absorbing the summary arrow or the answer headings', () => {
    const fragments = [
      ['A short passage discusses how people communicate.', 53, 525, 231],
      ['*conversation: 대화에서 당연하게 여기는', 57, 510, 227],
      ['배경지식 등을 의미한다) **gout:', 57, 499, 227],
      ['통풍 ***flare up: 재발하다', 192, 488, 92],
      ['\u{F003B}', 164, 473, 10],
      ['Whether', 63, 456, 37], ['people', 123, 456, 28],
      ['____(A)____', 170, 456, 58], ['certain', 252, 456, 32],
      ['information can reveal how close they are to each other.', 53, 440, 231],
      ['(A)', 66, 409, 13], ['(B)', 137, 409, 13],
    ] as const
    const page = { ...source[0], lines: fragments.map(([text, x, y, width], i) => ({
      ...source[0].lines[0], id: i + 1, text, x, y, width,
    })) }
    const input = draft([
      ...fragments.slice(0, 5).map(([text]) => text.replaceAll('*', '\\*')),
      'Whether people \\_\\_\\_\\_(A)\\_\\_\\_\\_ certain',
      fragments[9][0], '(A) (B)',
    ].join('\n'))
    input.questions[0].question_type = 'summary'
    const result = normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: fragments.length }])
    expect(result.passage).toContain('gout: 통풍 \\*\\*\\*flare up: 재발하다\n\n↓\n\n')
    expect(result.passage).toContain('certain information can reveal')
    expect(result.passage).toMatch(/each other\.\n+\(A\) \(B\)$/u)
    expect(copyBlockText(result.passage)).toContain('재발하다\n\n↓\n\nWhether')
  })

  it('uses the same column when a printed table row has fragments from both cells', () => {
    const fragments = [
      ['Left column', 56, 480], ['Right column', 192, 480],
      ['First topic', 56, 465], ['Career Talks', 192, 465],
      ['Second topic', 56, 450], ['and field insights', 192, 450],
      ['Third topic', 56, 435], ['from professionals', 192, 435],
    ] as const
    const pieces = fragments.flatMap(([text, x, y]) => text.split('').map((str, i) => ({
      str, x: x + i * 5, y, width: 5, height: 10, bold: false, underline: false,
    })))
    const page = { ...source[0], lines: buildSourceLines(pieces, 53, 595, 1, true) }
    const input = draft('Left column\nFirst topic\nSecond topic\nThird topic\n\nRight column\n\nCareer Talks\nand field insights\nfrom professionals')
    const result = normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: page.lines.length }])
    expect(result.passage).toBe(input.passage.replace('Career Talks\nand field insights\nfrom professionals', 'Career Talks and field insights from professionals'))
  })
  it('rejoins justified prose when PDF text fragments were extracted in a different order', () => {
    const rows = [
      ['Careful readers can use context to identify', 53, 480, 228],
      ['many of', 53, 465, 35], ['words', 143, 465, 30], ['the', 105, 465, 15],
      ['missing from', 191, 465, 56], ['a text.', 265, 465, 16],
      ['However, an ambiguous phrase may need review.', 53, 450, 228],
    ] as const
    const page = { ...source[0], lines: rows.map(([text, x, y, width], i) => ({
      ...source[0].lines[0], id: i + 1, text, x, y, width,
    })) }
    const input = draft([rows[0][0], 'many of the words missing from a text.', rows[6][0]].join('\n'))
    const result = normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: rows.length }])
    expect(result.passage).toBe(input.passage.replaceAll('\n', ' '))
  })

  it('joins around escaped blanks and emphasis without losing their markup or treating a year as an item', () => {
    const lines = ['The book describes a term as surface acting', 'and dates its first mention to September 10,',
      '1934. Readers should enter their answer in', '____ before proceeding to the next section.']
    const page = { ...source[0], lines: lines.map((text, i) => ({
      ...source[0].lines[0], id: i + 1, text, x: 53, y: 480 - i * 15, width: 228,
    })) }
    const input = draft(lines.join('\n').replace('surface acting', '*surface acting*').replace('____', '\\_\\_\\_\\_'))
    const result = normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: lines.length }])
    expect(result.passage).toBe(input.passage.replaceAll('\n', ' '))
    expect(copyBlockText(result.passage)).toBe(lines.join(' '))
  })
  it('keeps a printed notice heading even if formatting was dropped from the draft, and rejoins a wrapped email', () => {
    const lines = ['Registration Details', 'Reserve Your Spot: Email bookings@example.', 'org to sign up!', 'Capacity: 20 participants']
    const page = { ...source[0], lines: lines.map((text, i) => ({
      ...source[0].lines[0], id: i + 1, text, x: 55, y: 450 - i * 15, width: text.length * 5,
      marks: i === 0 ? [{ start: 0, end: text.length, bold: true, underline: false }] : [],
    })) }
    const input = draft(lines.join('\n'))
    input.questions[0].question_type = 'content_match'
    input.questions[0].stem = '다음 안내문의 내용과 일치하는 것은?'
    const result = normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: 4 }])
    expect(result.passage).toBe('Registration Details\n\nReserve Your Spot: Email bookings@example.org to sign up!\nCapacity: 20 participants')
    expect(copyBlockText(result.passage)).toBe(result.passage)
  })

  it('preserves the space after a complete email at the end of a sentence', () => {
    const lines = ['Please email bookings@example.org.', 'we look forward to hearing from you.']
    const page = { ...source[0], lines: lines.map((text, i) => ({
      ...source[0].lines[0], id: i + 1, text, x: 55, y: 450 - i * 15,
    })) }
    const input = draft(lines.join('\n'))
    expect(normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: 2 }]).passage).toBe(lines.join(' '))
  })
  it('joins physical wraps around inline choices without touching their formatting', () => {
    const input = draft(first + '\n④\n <u>' + second + '</u> ⑤\n' + third)
    const result = normalizeBookPassageParagraphs(input, source, refs)
    expect(result).toEqual(draft(first + ' ④ <u>' + second + '</u> ⑤ ' + third))
    expect(normalizeBookPassageParagraphs(result, source, refs)).toEqual(result)
  })

  it('keeps indented paragraphs and existing blank lines', () => {
    const input = draft(first + ' ④ ' + second + ' ⑤\n' + third)
    const indented = structuredClone(source)
    indented[0].lines[3].x += 12
    expect(normalizeBookPassageParagraphs(input, indented, refs)).toEqual(draft(input.passage.replace('\n', '\n\n')))
    const separated = draft(input.passage.replace('\n', '\n\n'))
    expect(normalizeBookPassageParagraphs(separated, source, refs)).toEqual(separated)
  })

  it('keeps notice titles, section labels, table rows and footnotes on separate lines', () => {
    const title = 'Gear Up for Good'
    const label = '• Shop the Sale'
    const intro = 'All donated equipment will be available'
    const continuation = 'for purchase on Saturday.'
    const footnote = '*Note: Please bring a reusable bag.'
    const notice: SourcePage[] = [{ ...source[0], lines: [
      [title, 55, 450], [label, 55, 435], [intro, 55, 420], [continuation, 55, 405],
      ['Baseball', 55, 390], ['Soccer', 150, 390], ['Swimming', 55, 375], ['Tennis', 150, 375],
      [footnote, 55, 360],
    ].map(([text, x, y], index) => ({
      id: index + 1, page: 53, x: Number(x), y: Number(y),
      width: String(text).length * 5, height: 10, text: String(text), marks: [],
    })) }]
    const input = draft([
      `<strong>${title}</strong>`, '• <strong>Shop the Sale</strong>', intro, continuation,
      'Baseball Soccer', 'Swimming Tennis', `\\${footnote}`,
    ].join('\n'))
    const result = normalizeBookPassageParagraphs(input, notice, [{ s: 1, e: 9 }])
    expect(result.passage).toBe(input.passage.replace(intro + '\n' + continuation, intro + ' ' + continuation))
  })

  it('separates notice fields and joins hanging continuations starting with numbers', () => {
    const lines = [
      'Location: State Museum', 'Dates & Times: Saturday from',
      '11:00 a.m. to 5:00 p.m.', '– Please bring a reusable bag',
      'and check in before entering.', '– Follow the posted signs.',
    ]
    const page = { ...source[0], lines: lines.map((text, i) => ({
      ...source[0].lines[0], id: i + 1, text, x: [55, 55, 115, 55, 63, 55][i],
      y: 450 - i * 15, width: text.length * 5,
    })) }
    const input = draft(lines.join('\n').replace('&', '&amp;'))
    input.questions[0].question_type = 'notice'
    expect(normalizeBookPassageParagraphs(input, [page], [{ s: 1, e: lines.length }]).passage)
      .toBe([lines[0], lines[1] + ' ' + lines[2], lines[3] + ' ' + lines[4], lines[5]].join('\n').replace('&', '&amp;'))
  })
})
