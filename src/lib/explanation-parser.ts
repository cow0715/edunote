/**
 * 해설 PDF 파서 — pdfjs-dist + 정규식
 *
 * PDF 텍스트에서 문항별 [출제의도], [해석], [풀이], [Words and Phrases]를 추출한다.
 * 18~45번 문항만 반환한다.
 */

export type ParsedExplanation = {
  question_number: number
  intent: string       // 출제의도
  translation: string  // 해석
  solution: string     // 풀이
  vocabulary: string   // Words and Phrases
}

/** PDF ArrayBuffer → 문항별 해설 배열 */
export async function parseExplanationPdf(buffer: ArrayBuffer): Promise<ParsedExplanation[]> {
  // unpdf — serverless 환경용 PDF 텍스트 추출 (worker 불필요)
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return parseExplanationText(text as string)
}

/** 텍스트 → 문항별 해설 파싱 */
export function parseExplanationText(text: string): ParsedExplanation[] {
  // 1) 문항 경계 찾기
  //    패턴: "18. [출제의도]", "18. [출제 의도]", "18 . [출제의도]", "41~42] [출제 의도]"
  const boundaryRe = /(\d{1,2})\s*(?:~\s*\d+\])?\s*\.?\s*\[출제\s*의도\]/g
  const boundaries: { num: number; idx: number }[] = []
  let m: RegExpExecArray | null

  while ((m = boundaryRe.exec(text)) !== null) {
    boundaries.push({ num: parseInt(m[1]), idx: m.index })
  }

  if (boundaries.length === 0) return []

  const results: ParsedExplanation[] = []
  // 장문 묶음(41~42, 43~45) 해석/어휘를 공유하기 위한 맵
  const sharedTranslation = new Map<number, string>()
  const sharedVocab = new Map<number, string>()

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].idx
    const end = i + 1 < boundaries.length ? boundaries[i + 1].idx : text.length
    const qNum = boundaries[i].num
    const block = text.substring(start, end)

    // 장문 묶음 헤더 감지 (예: "41~42]", "43~45]")
    const bundleMatch = block.match(/(\d+)\s*~\s*(\d+)\]\s*\.?\s*\[출제\s*의도\]/)
    if (bundleMatch) {
      const translation = extractSection(block, '해석')
      const vocab = extractSection(block, 'Words and Phrases')
      const fromNum = parseInt(bundleMatch[1])
      const toNum = parseInt(bundleMatch[2])
      for (let n = fromNum; n <= toNum; n++) {
        if (translation) sharedTranslation.set(n, translation)
        if (vocab) sharedVocab.set(n, vocab)
      }
      continue
    }

    // 18번 미만 스킵 (듣기 영역)
    if (qNum < 18) continue

    const intent = extractIntent(block)
    const translation = extractSection(block, '해석') || sharedTranslation.get(qNum) || ''
    const solution = extractSection(block, '풀이')
    const vocab = extractSection(block, 'Words and Phrases') || sharedVocab.get(qNum) || ''

    results.push({
      question_number: qNum,
      intent: cleanText(intent),
      translation: cleanText(translation),
      solution: cleanText(solution),
      vocabulary: cleanText(vocab),
    })
  }

  return results
}

/** [출제의도] 바로 뒤의 짧은 텍스트 추출 (예: "지칭 대상 파악") */
function extractIntent(block: string): string {
  const m = block.match(/\[출제\s*의도\]\s*([^\[]+?)(?:\s*\[|$)/)
  return m ? m[1] : ''
}

/** 블록에서 [header] 섹션의 텍스트를 indexOf 기반으로 추출 */
function extractSection(block: string, header: string): string {
  // [해석], [풀이], [Words and Phrases] 등 — 공백 변형 허용
  const markers = header === '출제 의도'
    ? ['[출제의도]', '[출제 의도]']
    : [`[${header}]`]

  let idx = -1
  let markerLen = 0
  for (const marker of markers) {
    idx = block.indexOf(marker)
    if (idx !== -1) {
      markerLen = marker.length
      break
    }
  }
  if (idx === -1) return ''

  const start = idx + markerLen

  // 다음 섹션 헤더까지의 범위를 찾음
  const nextHeaders = ['[해석]', '[풀이]', '[Words and Phrases]', '[출제의도]', '[출제 의도]']
  let end = block.length

  for (const nh of nextHeaders) {
    const nhIdx = block.indexOf(nh, start)
    if (nhIdx !== -1 && nhIdx < end) end = nhIdx
  }

  // 다음 문항 경계도 체크
  const nextQRe = /\d{1,2}\s*(?:~\s*\d+\])?\s*\.?\s*\[출제\s*의도\]/g
  nextQRe.lastIndex = start
  const nextQ = nextQRe.exec(block)
  if (nextQ && nextQ.index < end) end = nextQ.index

  return block.substring(start, end)
}

/** 텍스트 정리 — 페이지 번호 제거, 다중 공백 축소 */
function cleanText(text: string): string {
  return text
    .replace(/\n/g, ' ')
    .replace(/\s{2,}\d{1,2}\s{2,}/g, ' ')  // 페이지 번호 제거
    .replace(/\s+/g, ' ')
    .trim()
}
