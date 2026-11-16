import type { SourcePage } from '@/lib/book-pdf/source-map'
import type { BookUnitManifest } from '@/lib/book-pdf/types'

export function printedChoiceFixture(inline = false) {
  const key = 'reading:chapter:1:4', answer = inline ? 2 : 5
  const page: SourcePage = { page: 5, width: 600, height: 840, issues: [], lines: [] }
  function add(text: string, x: number, y: number, underline = false) {
    page.lines.push({ id: page.lines.length + 1, page: page.page, text, x, y, width: 100, height: 10,
      marks: underline ? [{ start: 0, end: text.indexOf(' '), underline: true, bold: false }] : [] })
  }
  add('[수능특강(영독) 1강 4번]', 160, 786)
  add(inline ? '4 다음 글의 밑줄 친 낱말의 쓰임이 적절하지 않은 것은?' : '4 다음 빈칸에 들어갈 말로 가장 적절한 것은?', 48, 770)
  add('People learn about the topic.', 55, 748)
  const sequence = inline ? '①②③③⑤' : '①③③④⑤'
  const words = ['certainty about it.', 'secure enough.', 'gifts for everyone.', 'Realizing this matters.', 'generates new ideas.']
  for (const [i, symbol] of [...sequence].entries()) {
    const y = 720 - i * 20, x = inline ? 125 : 48
    if (inline) add('It mentions', 55, y)
    add(symbol, x, y)
    add(words[i], x + 10, y, inline)
  }
  add('Exercise 4', 306, 786)
  add('[정답]', 306, 765)
  add(inline ? '②' : '⑤', 340, 765)
  add('[해석]', 306, 750)
  add('사람들은 주제에 관해 배운다.', 306, 735)
  add('[해설]', 306, 705)
  add('글의 흐름을 고려하면', 306, 685)
  add(inline ? '②' : '⑤', 430, 685)
  add(inline ? '의 secure를 insecure로 바꿔야 한다.' : '가 가장 적절하다.', 440, 685)
  if (!inline) for (const [i, symbol] of [...'①②③④'].entries()) {
    add(symbol, 306, 665 - i * 15)
    add('인쇄된 오답 선지의 해석이다.', 314, 665 - i * 15)
  }
  const unit: BookUnitManifest = { key, order: 1, pages: [page.page], left_text: '', right_text: '', translation: '', visual_required: false,
    questions: [{ key, chapter: 1, number: 4, section: 'exercise', source_kind: 'chapter', label: '1강 4번', label_page: page.page, printed_answer: answer }] }
  return { pages: [page], unit, answer, sequence }
}
