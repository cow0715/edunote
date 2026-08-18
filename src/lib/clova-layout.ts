// ── CLOVA OCR 좌표 기반 레이아웃 재구성 ──────────────────────────────────
// CLOVA 필드(토큰 + boundingPoly)를 시험지 구조에 맞는 줄 텍스트로 재조립한다.
//
// 단어시험지는 [뜻쓰기 2단 표] + [예문 1단 블록] 이 한 페이지에 섞일 수 있다.
// 페이지 전체를 한 번에 2단 판정하면 아래쪽 1단 문장 토큰이 좌/우로 갈라져 깨지므로,
// 예문 섹션 제목("예문 뜻쓰기"/"예문 빈칸")의 y좌표를 분기점으로 위/아래를 따로 재구성한다.

export type ClovaVertex = { x?: number; y?: number }
export type ClovaField = {
  inferText: string
  lineBreak?: boolean
  boundingPoly?: { vertices: ClovaVertex[] }
}

type Tok = { text: string; cx: number; cy: number; xMin: number; xMax: number; h: number }

export const CLOVA_LEFT_MARK = '━━━ LEFT COLUMN ━━━'
export const CLOVA_RIGHT_MARK = '━━━ RIGHT COLUMN ━━━'
export const CLOVA_EXAMPLE_MARK = '━━━ EXAMPLE SECTION (single column) ━━━'

// 시험지에 인쇄되는 예문 파트 제목. 인쇄 컴포넌트(vocab-test-print-sheet)와 맞춰야 한다.
const EXAMPLE_HEADING_PATTERNS = [/예문\s*뜻\s*쓰기/, /예문\s*빈\s*칸/, /예문\s*선\s*택/]

function toTokens(fields: ClovaField[]): Tok[] {
  return fields.map((f) => {
    const vs = f.boundingPoly!.vertices
    const xs = vs.map((v) => v.x ?? 0)
    const ys = vs.map((v) => v.y ?? 0)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    return { text: f.inferText, cx: (xMin + xMax) / 2, cy: (yMin + yMax) / 2, xMin, xMax, h: yMax - yMin }
  })
}

function medianHeight(toks: Tok[]) {
  const hs = [...toks.map((t) => t.h)].sort((a, b) => a - b)
  return hs[Math.floor(hs.length / 2)] || 20
}

/** 같은 y ± yTol 안이면 같은 줄로 묶고, 줄 안에서는 x 순으로 텍스트를 잇는다. */
function groupIntoLines(list: Tok[], yTol: number): string[] {
  if (list.length === 0) return []
  const sorted = [...list].sort((a, b) => a.cy - b.cy)
  const buckets: Tok[][] = []
  for (const t of sorted) {
    const last = buckets[buckets.length - 1]
    if (last && Math.abs(t.cy - last[last.length - 1].cy) <= yTol) last.push(t)
    else buckets.push([t])
  }
  return buckets.map((b) => b.sort((a, c) => a.cx - c.cx).map((t) => t.text).join(' '))
}

/** cx 분포의 최대 gap 으로 2단 여부와 분할선을 판단한다. */
function detectTwoColumn(toks: Tok[]) {
  const sortedCx = [...toks.map((t) => t.cx)].sort((a, b) => a - b)
  const xMinAll = sortedCx[0]
  const xMaxAll = sortedCx[sortedCx.length - 1]
  const xRange = xMaxAll - xMinAll
  let bestGap = 0
  let bestGapMid = 0
  for (let i = 1; i < sortedCx.length; i++) {
    const g = sortedCx[i] - sortedCx[i - 1]
    if (g > bestGap) {
      bestGap = g
      bestGapMid = (sortedCx[i] + sortedCx[i - 1]) / 2
    }
  }
  const gapRatio = xRange > 0 ? bestGap / xRange : 0
  const gapPos = xRange > 0 ? (bestGapMid - xMinAll) / xRange : 0
  const isTwoColumn = gapRatio >= 0.12 && gapPos >= 0.3 && gapPos <= 0.7
  return { isTwoColumn, splitX: bestGapMid, gapRatio, gapPos }
}

/**
 * 예문 섹션 제목 줄의 y좌표를 찾는다. 없으면 null.
 * 제목은 여러 토큰("B.", "예문", "뜻쓰기")으로 쪼개질 수 있어 줄 단위로 합쳐 검사한다.
 */
function findExampleSectionY(toks: Tok[], yTol: number): number | null {
  const sorted = [...toks].sort((a, b) => a.cy - b.cy)
  const buckets: Tok[][] = []
  for (const t of sorted) {
    const last = buckets[buckets.length - 1]
    if (last && Math.abs(t.cy - last[last.length - 1].cy) <= yTol) last.push(t)
    else buckets.push([t])
  }
  for (const bucket of buckets) {
    const text = bucket.map((t) => t.text).join('').replace(/\s+/g, '')
    if (EXAMPLE_HEADING_PATTERNS.some((p) => p.test(text))) {
      return Math.min(...bucket.map((t) => t.cy))
    }
  }
  return null
}

function layoutBlock(toks: Tok[], yTol: number, log?: (msg: string) => void): string[] {
  if (toks.length === 0) return []
  const { isTwoColumn, splitX, gapRatio, gapPos } = detectTwoColumn(toks)
  if (!isTwoColumn) {
    const lines = groupIntoLines(toks, yTol)
    log?.(`[CLOVA] 1단 레이아웃 감지 (gap=${gapRatio.toFixed(2)}, pos=${gapPos.toFixed(2)}), 라인 ${lines.length}개`)
    return lines
  }
  const leftLines = groupIntoLines(toks.filter((t) => t.cx < splitX), yTol)
  const rightLines = groupIntoLines(toks.filter((t) => t.cx >= splitX), yTol)
  log?.(`[CLOVA] 2단 레이아웃 감지 (gap=${gapRatio.toFixed(2)}, pos=${gapPos.toFixed(2)}), 좌 ${leftLines.length}줄 / 우 ${rightLines.length}줄`)
  return [CLOVA_LEFT_MARK, ...leftLines, CLOVA_RIGHT_MARK, ...rightLines]
}

/**
 * CLOVA 필드 목록을 레이아웃이 반영된 텍스트로 재구성한다.
 * - 좌표가 없는 필드가 섞여 있으면 lineBreak 기반 단순 조립으로 폴백
 * - 예문 섹션 제목이 있으면 그 y 위쪽만 2단 판정하고, 아래는 항상 1단(문장)으로 조립
 */
export function reconstructClovaLayout(fields: ClovaField[], log?: (msg: string) => void): string {
  if (fields.length === 0) return ''

  const hasCoords = fields.every((f) => f.boundingPoly?.vertices && f.boundingPoly.vertices.length >= 4)
  if (!hasCoords) {
    const lines: string[] = []
    let buf: string[] = []
    for (const field of fields) {
      buf.push(field.inferText)
      if (field.lineBreak) {
        lines.push(buf.join(' '))
        buf = []
      }
    }
    if (buf.length > 0) lines.push(buf.join(' '))
    return lines.join('\n')
  }

  const toks = toTokens(fields)
  const yTol = Math.max(medianHeight(toks) * 0.6, 8)

  const exampleY = findExampleSectionY(toks, yTol)
  if (exampleY === null) {
    return layoutBlock(toks, yTol, log).join('\n')
  }

  // 제목 줄 자체는 예문 블록에 포함시킨다 (제목 위 아주 근접한 토큰이 잘려나가지 않도록 여유)
  const cut = exampleY - yTol
  const upper = toks.filter((t) => t.cy < cut)
  const lower = toks.filter((t) => t.cy >= cut)
  log?.(`[CLOVA] 예문 섹션 감지 (y=${Math.round(exampleY)}), 상단 ${upper.length}토큰 / 예문 ${lower.length}토큰`)

  const upperLines = layoutBlock(upper, yTol, log)
  const lowerLines = groupIntoLines(lower, yTol)
  return [...upperLines, CLOVA_EXAMPLE_MARK, ...lowerLines].join('\n')
}
