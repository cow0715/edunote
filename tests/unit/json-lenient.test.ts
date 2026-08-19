import { describe, expect, it } from 'vitest'
import { jsonrepair } from 'jsonrepair'
import { fixUnescapedQuotesInJson } from '@/lib/json-lenient'

// 문제지 PDF 파서(parseWeekProblemSheetPage)가 실제로 낸 실패 형태를 재현한다.
// 2026-08-19 실측: 같은 시험지 3회 파싱 중 2회가 지문 속 대화 따옴표 때문에 jsonrepair 로도 안 살아났다.
const BROKEN = `\`\`\`json
[
  {
    "question_number": 43,
    "question_type": "글의 순서 배열",
    "question_style": "objective",
    "passage": "The next day, the judge told Mr. Grumbles, "Before receiving the sentence, you will have to go out and gather all the pieces of paper that you threw out yesterday." **(b) He** replied, "I can't do that! The wind: it scattered them, and I won't know where to find them." The judge then replied, "The same way, simple comments may destroy trust." *grumpy 심술궂은",
    "question_text": "주어진 글 (A)에 이어질 내용을 순서에 맞게 배열한 것으로 가장 적절한 것은?",
    "choices": ["① (A)-(C)-(B)", "② (B)-(A)-(C)", "③ (B)-(C)-(A)", "④ (C)-(A)-(B)", "⑤ (C)-(B)-(A)"],
    "needs_source_image": false,
    "source_image_reason": null,
    "source_page": 1,
    "source_bbox": null
  },
  {
    "question_number": 44,
    "question_type": "빈칸 추론",
    "question_style": "objective",
    "passage": "She said "no" and left. **Bold** and <u>under</u> text.",
    "question_text": "빈칸에 들어갈 말로 가장 적절한 것은?",
    "choices": ["① a", "② b"],
    "needs_source_image": true,
    "source_image_reason": "table",
    "source_page": 2,
    "source_bbox": {"x": 0.1, "y": 0.2, "width": 0.8, "height": 0.5}
  }
]
\`\`\``

function extract(raw: string) {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  return cleaned.slice(start, end + 1)
}

describe('fixUnescapedQuotesInJson', () => {
  it('실측 실패 케이스: jsonrepair 단독으로는 안 되고, 고친 뒤엔 파싱된다', () => {
    const candidate = extract(BROKEN)
    expect(() => JSON.parse(jsonrepair(candidate))).toThrow()

    const fixed = fixUnescapedQuotesInJson(candidate)
    const parsed = JSON.parse(jsonrepair(fixed)) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(2)
    expect(parsed[0].question_number).toBe(43)
    expect(parsed[0].passage).toContain('"Before receiving the sentence,')
    expect(parsed[0].passage).toContain(`"I can't do that! The wind: it scattered them, and I won't know where to find them."`)
    expect(parsed[0].passage).toContain('*grumpy 심술궂은')
    expect(parsed[0].choices).toEqual(['① (A)-(C)-(B)', '② (B)-(A)-(C)', '③ (B)-(C)-(A)', '④ (C)-(A)-(B)', '⑤ (C)-(B)-(A)'])
    expect(parsed[1].passage).toBe('She said "no" and left. **Bold** and <u>under</u> text.')
    expect(parsed[1].source_bbox).toEqual({ x: 0.1, y: 0.2, width: 0.8, height: 0.5 })
  })

  it('정상 JSON 은 바꾸지 않는다', () => {
    const ok = JSON.stringify([
      { a: 'plain', b: 'with \\"escaped\\" quotes', c: ['x', 'y'], d: null, e: 1.5, f: true, g: { h: 'i' } },
      { a: 'ends with colon:', b: 'comma, then word', c: 'trailing quote"' },
    ])
    expect(fixUnescapedQuotesInJson(ok)).toBe(ok)
  })

  it('이미 이스케이프된 따옴표는 건드리지 않는다', () => {
    const s = '["He said \\"hi\\" loudly"]'
    expect(fixUnescapedQuotesInJson(s)).toBe(s)
    expect(JSON.parse(s)).toEqual(['He said "hi" loudly'])
  })

  it('따옴표 뒤에 콤마+공백+단어가 오면 본문으로 본다', () => {
    const s = '{"p": "She said "no", and then left", "q": 1}'
    const parsed = JSON.parse(fixUnescapedQuotesInJson(s))
    expect(parsed).toEqual({ p: 'She said "no", and then left', q: 1 })
  })

  it('알려진 한계: 따옴표 뒤에 콤마+따옴표가 오면 구분 못 한다 (문서화)', () => {
    const s = '{"p": "said "yes", "no" ok", "q": 1}'
    expect(() => JSON.parse(fixUnescapedQuotesInJson(s))).toThrow()
  })
})
