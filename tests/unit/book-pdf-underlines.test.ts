import { describe, expect, it } from 'vitest'
import { bookItemUnderlined, bookUnderlineSegments } from '@/lib/book-pdf/underlines'
const ops = { save: 1, restore: 2, transform: 3, setStrokeRGBColor: 4, setLineWidth: 5, constructPath: 6, stroke: 20 }
const stroke = [ops.stroke, [], [10, 20, 40, 20]]
describe('source underline geometry', () => {
  it('recognizes thin black strokes while excluding boxes, fills, colored and thick rules', () => {
    expect(bookUnderlineSegments({ fnArray: [6], argsArray: [stroke] }, ops)).toHaveLength(1)
    expect(bookUnderlineSegments({ fnArray: [6, 6], argsArray: [[20, [], [10, 20, 40, 40]], [23, [], [10, 20, 40, 20]]] }, ops)).toEqual([])
    expect(bookUnderlineSegments({ fnArray: [4, 6], argsArray: [['#ff0000'], stroke] }, ops)).toEqual([])
    expect(bookUnderlineSegments({ fnArray: [5, 6], argsArray: [[3], stroke] }, ops)).toEqual([])
  })
  it('applies and restores the graphics transform before matching text coordinates', () => {
    const lines = bookUnderlineSegments({ fnArray: [1, 3, 6, 2, 6], argsArray: [[], [2, 0, 0, 2, 1, 3], stroke, [], stroke] }, ops)
    // A one-point rule scales to two points and no longer qualifies as an underline.
    expect(lines).toEqual([{ start: [10, 20], end: [40, 20] }])
  })
  it('requires substantial text overlap and a stroke immediately below the baseline', () => {
    const item = { str: 'word', transform: [10, 0, 0, 10, 10, 22], width: 30 }
    expect(bookItemUnderlined(item, { start: [10, 20], end: [40, 20] })).toBe(true)
    expect(bookItemUnderlined(item, { start: [35, 20], end: [45, 20] })).toBe(false)
    expect(bookItemUnderlined(item, { start: [10, 23], end: [40, 23] })).toBe(false)
    expect(bookItemUnderlined(item, { start: [10, 10], end: [40, 10] })).toBe(false)
  })
})
