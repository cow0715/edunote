/**
 * 단어시험 사진 채점 파이프라인 end-to-end 테스트 (DB 없이)
 *
 * 채워진 시험지 이미지(갤러리 "채워진 시험지" 탭 캡처)를 실제 gradeVocabPhoto 에 넣어
 * OCR(CLOVA+Claude) → 예문 원문 전달 → 유형별 채점(빈칸/선택 코드, 나머지 LLM) 을 그대로 돌리고,
 * sample-data.ts 의 기대값(SAMPLE_EXPECTED)과 대조한다.
 *
 * ⚠️ 실제 LLM/OCR 호출 = 과금. 사용자가 요청할 때만 실행.
 *
 * 사용법:
 *   npx tsx scripts/test-vocab-grade-image.ts <이미지경로>
 *   npx tsx scripts/test-vocab-grade-image.ts <이미지경로> --preset "24 + 뜻 4 + 빈칸 3 + 선택 3"
 */

import fs from 'fs'
import path from 'path'

// ⚠️ ESM 에서는 import 가 호이스팅되므로 정적 import 전에 env 를 못 읽는다.
// anthropic.ts 가 모듈 로드 시 클라이언트를 만들기 때문에 env 를 먼저 채우고 동적 import 한다.
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
loadEnv()

type VocabOcrExampleItem = import('../src/lib/prompts').VocabOcrExampleItem

const args = process.argv.slice(2)
const filePath = args.find((a) => !a.startsWith('--'))
if (!filePath) {
  console.error('사용법: npx tsx scripts/test-vocab-grade-image.ts <이미지경로>')
  process.exit(1)
}

async function main() {
  const { gradeVocabPhoto } = await import('../src/lib/anthropic')
  const { extractBlankAnswer, extractChoiceAnswerIndex, parseChoiceOptions } = await import('../src/lib/vocab-example-blank')
  const { buildSampleItems, SAMPLE_STUDENT_ANSWERS, SAMPLE_EXPECTED } = await import('../src/app/dev/vocab-print-preview/sample-data')

  // --preset legacy 면 기존 형식(뜻쓰기 40, 예문 없음). 기본은 갤러리 프리셋 (24 + 뜻 4 + 빈칸 3 + 선택 3)
  const legacy = args.includes('--preset=legacy') || args.includes('--legacy')
  const items = legacy ? buildSampleItems(40, 0, 0, 0) : buildSampleItems(24, 4, 3, 3)
  const timeOnly = args.includes('--time-only')

  // grade-vocab-photo/route.ts 와 같은 방식으로 정답·예문 컨텍스트 구성
  const correctAnswers = new Map<number, string | null>()
  const exampleItems: VocabOcrExampleItem[] = []
  for (const item of items) {
    const source = item.prompt_source ?? 'word'
    if (source === 'example_meaning' || source === 'example' || source === 'example_choice') {
      const kind = source === 'example' ? 'blank' : source === 'example_choice' ? 'choice' : 'meaning'
      exampleItems.push({ number: item.test_number, printed_sentence: item.prompt_text ?? '', kind })
      let correct: string | null = item.meaning
      if (kind === 'blank') correct = extractBlankAnswer(item.example_sentence, item.prompt_text) ?? item.display_word
      if (kind === 'choice') {
        const idx = extractChoiceAnswerIndex(item.example_sentence, item.prompt_text)
        const opts = parseChoiceOptions(item.prompt_text)
        correct = (idx !== null && opts ? opts[idx] : null) ?? item.display_word
      }
      correctAnswers.set(item.test_number, correct)
    } else {
      correctAnswers.set(item.test_number, item.meaning)
    }
  }

  const abs = path.resolve(process.cwd(), filePath!)
  const buf = fs.readFileSync(abs)
  const ext = path.extname(abs).toLowerCase()
  const mimeType = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  console.log(`📄 ${abs} (${mimeType}, ${(buf.length / 1024).toFixed(0)}KB)`)
  console.log(`   문항 ${items.length}개 · 예문 ${exampleItems.length}개 (뜻 ${exampleItems.filter((e) => e.kind === 'meaning').length} / 빈칸 ${exampleItems.filter((e) => e.kind === 'blank').length} / 선택 ${exampleItems.filter((e) => e.kind === 'choice').length})`)
  console.log(`   CLOVA: ${process.env.CLOVA_OCR_API_URL ? 'ON' : 'OFF (Claude Vision fallback)'}\n`)

  const started = Date.now()
  const results = await gradeVocabPhoto(buf.toString('base64'), mimeType, {
    correctAnswers,
    exampleItems,
  })
  const ms = Date.now() - started
  if (timeOnly) {
    console.log(`⏱  ${(ms / 1000).toFixed(1)}s  (문항 ${results.length}개 추출, 정답 ${results.filter((r) => r.is_correct).length}개)`)
    return
  }

  // ── 대조 ──────────────────────────────────────────────────────────────
  const byNumber = new Map(results.map((r) => [r.number, r]))
  let ocrOk = 0, ocrTotal = 0, gradeOk = 0, gradeTotal = 0
  const rows: string[] = []
  for (const item of items) {
    const n = item.test_number
    const r = byNumber.get(n)
    const wrote = SAMPLE_STUDENT_ANSWERS[n] ?? ''
    const expected = SAMPLE_EXPECTED[n]
    const read = (r?.student_answer ?? '').trim()
    // OCR 정확도: 학생이 쓴 것과 읽은 것이 같은가 (공백·대소문자 무시)
    const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
    const ocrMatch = norm(read) === norm(wrote)
    ocrTotal += 1; if (ocrMatch) ocrOk += 1
    const gradeMatch = r ? r.is_correct === expected : false
    gradeTotal += 1; if (gradeMatch) gradeOk += 1
    const src = (item.prompt_source ?? 'word').padEnd(15)
    const flag = !r ? '⚠️ 누락' : (ocrMatch ? '  ' : '👁') + (gradeMatch ? '  ' : '❌')
    rows.push(`${String(n).padStart(2)}  ${src} 썼음=${JSON.stringify(wrote).padEnd(14)} 읽음=${JSON.stringify(read).padEnd(14)} 채점=${r ? (r.is_correct ? '✓' : '✗') : '-'} 기대=${expected ? '✓' : '✗'}  ${flag}`)
  }
  console.log(rows.join('\n'))
  console.log(`\n⏱  ${(ms / 1000).toFixed(1)}s`)
  console.log(`👁  OCR 일치  ${ocrOk}/${ocrTotal}  (학생이 쓴 글자를 그대로 읽었는가)`)
  console.log(`✅ 채점 일치  ${gradeOk}/${gradeTotal}  (기대한 정오와 같은가)`)
  const extra = results.filter((r) => !items.some((i) => i.test_number === r.number))
  if (extra.length) console.log(`⚠️  시험지에 없는 번호 ${extra.length}개 추출됨: ${extra.map((r) => r.number).join(', ')}`)
  console.log('\n범례: 👁 = OCR이 다르게 읽음, ❌ = 채점 결과가 기대와 다름')
}

main().catch((e) => {
  console.error('❌ 실패:', e)
  process.exit(1)
})
