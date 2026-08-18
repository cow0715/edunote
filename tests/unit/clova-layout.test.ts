import { describe, expect, it } from 'vitest'
import {
  reconstructClovaLayout,
  ClovaField,
  CLOVA_LEFT_MARK,
  CLOVA_RIGHT_MARK,
  CLOVA_EXAMPLE_MARK,
} from '@/lib/clova-layout'

/** (x, y) 중심, w×h 크기의 토큰 필드를 만든다 */
function field(text: string, x: number, y: number, w = 40, h = 20): ClovaField {
  return {
    inferText: text,
    lineBreak: false,
    boundingPoly: {
      vertices: [
        { x: x - w / 2, y: y - h / 2 },
        { x: x + w / 2, y: y - h / 2 },
        { x: x + w / 2, y: y + h / 2 },
        { x: x - w / 2, y: y + h / 2 },
      ],
    },
  }
}

/** 시험지 폭 1000px. 좌단 x=100~350, 우단 x=600~850. */
function twoColumnRows(count: number, startY = 100, rowH = 40): ClovaField[] {
  const out: ClovaField[] = []
  for (let i = 0; i < count; i++) {
    const y = startY + i * rowH
    out.push(field(`${i + 1}.`, 100, y), field(`word${i + 1}`, 180, y), field(`뜻${i + 1}`, 330, y))
    out.push(field(`${count + i + 1}.`, 600, y), field(`word${count + i + 1}`, 680, y), field(`뜻${count + i + 1}`, 830, y))
  }
  return out
}

describe('reconstructClovaLayout', () => {
  it('좌표 없는 필드가 섞이면 lineBreak 기반으로 조립한다', () => {
    const fields: ClovaField[] = [
      { inferText: '1.', lineBreak: false },
      { inferText: 'apple', lineBreak: true },
      { inferText: '2.', lineBreak: false },
      { inferText: 'banana', lineBreak: true },
    ]
    expect(reconstructClovaLayout(fields)).toBe('1. apple\n2. banana')
  })

  it('2단 표는 LEFT/RIGHT 로 분리한다', () => {
    const text = reconstructClovaLayout(twoColumnRows(5))
    const lines = text.split('\n')
    expect(lines[0]).toBe(CLOVA_LEFT_MARK)
    const rightIndex = lines.indexOf(CLOVA_RIGHT_MARK)
    expect(rightIndex).toBeGreaterThan(0)
    expect(lines.slice(1, rightIndex)).toEqual([
      '1. word1 뜻1', '2. word2 뜻2', '3. word3 뜻3', '4. word4 뜻4', '5. word5 뜻5',
    ])
    expect(lines.slice(rightIndex + 1)).toEqual([
      '6. word6 뜻6', '7. word7 뜻7', '8. word8 뜻8', '9. word9 뜻9', '10. word10 뜻10',
    ])
    expect(text).not.toContain(CLOVA_EXAMPLE_MARK)
  })

  it('예문 섹션 제목이 있으면 위는 2단, 아래는 1단 문장으로 조립한다', () => {
    const upper = twoColumnRows(5)                       // y 100~260
    const headingY = 340
    const heading = [
      field('B.', 60, headingY, 20), field('예문', 100, headingY), field('뜻쓰기', 150, headingY),
    ]
    // 예문 문장은 페이지 전폭에 걸쳐 있다 (x 100~850). 전체를 2단 판정하면 문장이 좌/우로 갈라진다.
    const sentence1 = [
      field('11.', 100, 400), field('The', 160, 400), field('room', 230, 400), field('price', 300, 400),
      field('(includes)', 400, 400, 80), field('breakfast.', 520, 400, 70), field('포함하다', 750, 400, 80),
    ]
    const sentence2 = [
      field('12.', 100, 440), field("Don't", 170, 440), field('(provoke)', 260, 440, 70), field('the', 340, 440),
      field('angry', 410, 440), field('dog.', 480, 440), field('자극하다', 700, 440, 80),
    ]
    const text = reconstructClovaLayout([...upper, ...heading, ...sentence1, ...sentence2])
    const lines = text.split('\n')

    // 상단은 여전히 2단
    expect(lines[0]).toBe(CLOVA_LEFT_MARK)
    expect(lines).toContain(CLOVA_RIGHT_MARK)
    // 예문 마커 이후는 문장이 통째로 한 줄
    const exampleIndex = lines.indexOf(CLOVA_EXAMPLE_MARK)
    expect(exampleIndex).toBeGreaterThan(0)
    const exampleLines = lines.slice(exampleIndex + 1)
    expect(exampleLines).toEqual([
      'B. 예문 뜻쓰기',
      '11. The room price (includes) breakfast. 포함하다',
      "12. Don't (provoke) the angry dog. 자극하다",
    ])
    // 상단 2단 구간에 예문 토큰이 섞이지 않는다
    expect(lines.slice(0, exampleIndex).join(' ')).not.toContain('includes')
  })

  it('예문 빈칸 제목도 섹션 분기점으로 인식한다', () => {
    const upper = twoColumnRows(3)
    const heading = [field('C.', 60, 300, 20), field('예문', 100, 300), field('빈칸', 150, 300)]
    const sentence = [
      field('7.', 100, 350), field('The', 160, 350), field('police', 230, 350), field('quickly', 310, 350),
      field('suppressed', 420, 350, 90), field('the', 520, 350), field('riot.', 580, 350),
    ]
    const text = reconstructClovaLayout([...upper, ...heading, ...sentence])
    const lines = text.split('\n')
    const exampleIndex = lines.indexOf(CLOVA_EXAMPLE_MARK)
    expect(exampleIndex).toBeGreaterThan(0)
    expect(lines[lines.length - 1]).toBe('7. The police quickly suppressed the riot.')
  })

  it('예문만 있는 시험지(상단 없음)도 처리한다', () => {
    const heading = [field('예문', 100, 100), field('뜻쓰기', 150, 100)]
    const sentence = [field('1.', 100, 150), field('I', 140, 150), field('(like)', 190, 150), field('you.', 250, 150), field('좋아하다', 500, 150, 80)]
    const text = reconstructClovaLayout([...heading, ...sentence])
    const lines = text.split('\n')
    expect(lines[0]).toBe(CLOVA_EXAMPLE_MARK)
    expect(lines).toContain('1. I (like) you. 좋아하다')
  })
})
