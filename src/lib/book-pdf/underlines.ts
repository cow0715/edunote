type Point = [number, number]
type Matrix = [number, number, number, number, number, number]
type State = { matrix: Matrix; black: boolean; width: number }
type OperatorList = { fnArray: ArrayLike<number>; argsArray: unknown[][] }
type Operators = { save: number; restore: number; transform: number; setStrokeRGBColor: number; setLineWidth: number; constructPath: number; stroke: number }
export type UnderlineSegment = { start: Point; end: Point }

function point(m: Matrix, x: number, y: number): Point { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] }
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
}

/** Only thin black horizontal strokes qualify; boxes, fills and colored rules do not. */
export function bookUnderlineSegments(list: OperatorList, ops: Operators): UnderlineSegment[] {
  let state: State = { matrix: [1, 0, 0, 1, 0, 0], black: true, width: 1 }
  const stack: State[] = [], result: UnderlineSegment[] = []
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i], args = list.argsArray[i]
    if (op === ops.save) stack.push({ ...state, matrix: [...state.matrix] })
    else if (op === ops.restore) state = stack.pop() ?? state
    else if (op === ops.transform) state.matrix = multiply(state.matrix, args as Matrix)
    else if (op === ops.setLineWidth) state.width = Number(args[0])
    else if (op === ops.setStrokeRGBColor) state.black = args[0] === '#000000' || (args.length === 3 && args.every((v) => v === 0))
    else if (op === ops.constructPath && args[0] === ops.stroke && state.black) {
      const bounds = args[2] as ArrayLike<number> | undefined
      if (!bounds || bounds.length !== 4) continue
      const a = point(state.matrix, bounds[0], bounds[1]), b = point(state.matrix, bounds[2], bounds[3])
      const width = state.width * Math.hypot(state.matrix[0], state.matrix[1])
      if (Math.abs(a[1] - b[1]) > 0.5 || Math.abs(a[0] - b[0]) < 2 || width <= 0 || width > 1.5) continue
      result.push({ start: a[0] < b[0] ? a : b, end: a[0] < b[0] ? b : a })
    }
  }
  return result
}

export function bookItemUnderlined(item: { str: string; transform: number[]; width: number }, line: UnderlineSegment) {
  if (!item.str.trim() || item.width <= 0) return false
  const [x, y] = item.transform.slice(4), distance = y - line.start[1]
  const overlap = Math.max(0, Math.min(x + item.width, line.end[0]) - Math.max(x, line.start[0]))
  return distance >= 0.3 && distance <= 4.5 && overlap / item.width >= 0.7
}
