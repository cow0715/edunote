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

// 섹션 헤더의 모든 변형 (공백, 전각 괄호, 괄호 없는 형식 등)
const SECTION_VARIANTS: Record<string, string[]> = {
  '출제의도': [
    '[출제의도]', '[출제 의도]', '[출 제 의 도]',
    '【출제의도】', '【출제 의도】',
    '출제의도[ ]', '출제 의도[ ]', '출제의도[]', '출제 의도[]',
  ],
  '해석': [
    '[해석]', '[해 석]',
    '【해석】', '【해 석】',
    '해석[ ]', '해석[]',
  ],
  '풀이': [
    '[풀이]', '[풀 이]',
    '【풀이】', '【풀 이】',
    '풀이[ ]', '풀이[]',
  ],
  '어휘': [
    '[Words and Phrases]', '[Words & Phrases]',
    '[Vocabulary]', '[어휘]',
    '【Words and Phrases】',
    'Words and Phrases[ ]', 'Words and Phrases[]',
    '어휘[ ]', '어휘[]',
  ],
}

/** 모든 섹션 헤더 목록 (끝 위치 탐색용) */
const ALL_SECTION_MARKERS = Object.values(SECTION_VARIANTS).flat()

/** 텍스트 → 문항별 해설 파싱 */
export function parseExplanationText(text: string): ParsedExplanation[] {
  // 1) 문항 경계 찾기
  //    패턴: "18. [출제의도]", "18. [출제 의도]", "18 . [출제의도]", "41~42] [출제 의도]"
  //    전각괄호 포함: "18.【출제의도】"
  // 패턴 1: "18. [출제의도]" / "18.【출제의도】"
  // 패턴 2: "18. 출제 의도" (괄호 없는 형식, 일부 EBS PDF)
  const boundaryRe = /(\d{1,2})\s*(?:~\s*\d+\])?\s*\.?\s*(?:[[\u3010]출제\s*의도[\]\u3011]|출제\s*의도(?:\s*\[\s*\])?)/g
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
    const bundleMatch = block.match(/(\d+)\s*~\s*(\d+)\]/)
    if (bundleMatch) {
      const translation = extractSection(block, '해석')
      const vocab = extractSection(block, '어휘')
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
    const vocab = extractSection(block, '어휘') || sharedVocab.get(qNum) || ''

    results.push({
      question_number: qNum,
      intent: cleanText(intent),
      translation: cleanText(translation),
      solution: cleanText(solution),
      vocabulary: cleanVocabText(vocab),
    })
  }

  return results
}

/** [출제의도] 바로 뒤의 짧은 텍스트 추출 (예: "지칭 대상 파악") */
function extractIntent(block: string): string {
  // 반각/전각 괄호 형식: [출제의도] 내용
  const m1 = block.match(/[[\u3010]출제\s*의도[\]\u3011]\s*([^\[【]+?)(?:\s*[[\[【]|$)/)
  if (m1) return m1[1]
  // 괄호 없는 형식: "출제 의도 내용[ ]" 또는 "출제 의도 내용 해석"
  const m2 = block.match(/출제\s*의도\s+(.+?)(?:\s*\[\s*\]|\s*(?:해석|풀이|Words)|$)/)
  return m2 ? m2[1] : ''
}

/** 블록에서 섹션 키의 텍스트를 추출 (변형 헤더 모두 시도) */
function extractSection(block: string, sectionKey: string): string {
  const markers = SECTION_VARIANTS[sectionKey] ?? [`[${sectionKey}]`]

  let idx = -1
  let markerLen = 0
  for (const marker of markers) {
    const found = block.indexOf(marker)
    if (found !== -1) {
      idx = found
      markerLen = marker.length
      break
    }
  }
  if (idx === -1) return ''

  const start = idx + markerLen
  let end = block.length

  // 다음 섹션 헤더까지 범위 찾기
  for (const marker of ALL_SECTION_MARKERS) {
    const nhIdx = block.indexOf(marker, start)
    if (nhIdx !== -1 && nhIdx < end) end = nhIdx
  }

  // 다음 문항 경계도 체크
  const nextQRe = /\d{1,2}\s*(?:~\s*\d+\])?\s*\.?\s*[[\u3010]출제\s*의도[\]\u3011]/g
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

/**
 * 어휘 텍스트 정리 — cleanText + unpdf가 이탤릭/볼드 폰트를 *word* 로 변환한 닫는 별표 제거
 * *단어 (중요도 별표) 형태는 유지, *단어* → *단어
 */
function cleanVocabText(text: string): string {
  return cleanText(text).replace(/([^\s*])\*+/g, '$1')
}
