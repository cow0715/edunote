import { getAuth, err, ok } from '@/lib/api'
import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'
import { buildVocabOcrClovaPrompt, VOCAB_OCR_VISION_PROMPT } from '@/lib/prompts'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const maxDuration = 120

type OcrItem = { number: number; english_word: string; student_answer: string | null }

export type OcrTestResult = {
  items?: OcrItem[]
  rawText?: string
  ms: number
  error?: string
}

// ── 개선된 Claude Vision 프롬프트 (손글씨 힌트 추가) ──────────────────────
const ENHANCED_VISION_PROMPT = `이 단어 시험지에서 각 문항의 내용을 읽어주세요.
한국 학생이 손으로 쓴 한글 뜻풀이가 포함되어 있습니다.

━━━ 읽기 규칙 ━━━
1. 인쇄된 번호와 영어 단어(구)를 정확히 읽으세요.
2. 학생이 손으로 쓴 한글 답은 보이는 그대로만 읽으세요.
   - 맞춤법 틀려도 수정 금지
   - 판독 불가 → null, 미기재 → ""

━━━ 손글씨 주의사항 ━━━
- ㅓ와 ㅗ 혼동 주의 (예: 정확한 → 정족관으로 오인 금지)
- ㅏ/ㅑ, ㅓ/ㅕ는 획 개수로 구분
- 받침 혼동 주의 (ㄴ/ㄱ, ㄹ/ㄴ, ㅇ/ㅎ 등)
- 흘려 쓴 글씨는 획의 방향과 형태로 판단
- 붙여 쓴 글자도 자모 단위로 정확히 분리

⚠️ 학생 답을 교정·추측하지 마세요. 채점하지 마세요.

JSON 배열만 출력:
[{"number":1,"english_word":"necessary","student_answer":"필수적인"},{"number":2,"english_word":"abandon","student_answer":null}]`

// ── CLOVA OCR ─────────────────────────────────────────────────────────────
async function callClova(fileData: string, mimeType: string): Promise<{ text: string; ms: number }> {
  const apiUrl = process.env.CLOVA_OCR_API_URL
  const secret = process.env.CLOVA_OCR_SECRET
  if (!apiUrl || !secret) throw new Error('CLOVA 환경변수 미설정')

  const format = mimeType.includes('png') ? 'png'
    : mimeType.includes('gif') ? 'gif'
    : mimeType.includes('webp') ? 'webp'
    : 'jpeg'

  const start = Date.now()
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': secret },
    body: JSON.stringify({
      version: 'V2',
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      lang: 'ko',
      images: [{ format, name: 'test', data: fileData }],
    }),
  })

  if (!res.ok) throw new Error(`CLOVA 오류: ${res.status}`)

  const data = await res.json()
  const fields: { inferText: string; lineBreak: boolean }[] = data.images?.[0]?.fields ?? []
  if (fields.length === 0) throw new Error('CLOVA 결과 없음')

  const lines: string[] = []
  let cur: string[] = []
  for (const f of fields) {
    cur.push(f.inferText)
    if (f.lineBreak) { lines.push(cur.join(' ')); cur = [] }
  }
  if (cur.length > 0) lines.push(cur.join(' '))

  return { text: lines.join('\n'), ms: Date.now() - start }
}

// ── Google Cloud Vision ───────────────────────────────────────────────────
async function callGoogle(fileData: string): Promise<{ text: string; ms: number }> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY
  if (!apiKey) throw new Error('GOOGLE_CLOUD_VISION_API_KEY 미설정')

  const start = Date.now()
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: fileData },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['ko', 'en'] },
        }],
      }),
    },
  )

  if (!res.ok) throw new Error(`Google Vision 오류: ${res.status}`)

  const data = await res.json()
  const text: string = data.responses?.[0]?.fullTextAnnotation?.text ?? ''
  if (!text) throw new Error('Google Vision 결과 없음')

  return { text, ms: Date.now() - start }
}

// ── Claude 파싱/OCR ───────────────────────────────────────────────────────
async function callClaude(
  prompt: string,
  model: string,
  fileContent?: object,
): Promise<{ items: OcrItem[]; rawText: string; ms: number }> {
  const start = Date.now()

  const content = fileContent
    ? [fileContent, { type: 'text', text: prompt }]
    : prompt

  const res = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: content as Anthropic.MessageParam['content'] }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  const items: OcrItem[] = JSON.parse(jsonrepair(raw.replace(/```json\n?|\n?```/g, '').trim()))

  return { items, rawText: raw, ms: Date.now() - start }
}

// ── 메인 라우트 ───────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { fileData, mimeType, tests } = await request.json() as {
    fileData: string
    mimeType: string
    tests: string[]
  }
  if (!fileData || !mimeType || !tests?.length) return err('파라미터 누락')

  const fileContent = mimeType.startsWith('image/')
    ? { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileData } }
    : null

  const results: Record<string, OcrTestResult> = {}

  const runners = tests.map(async (test) => {
    try {
      switch (test) {

        case 'clova': {
          const { text, ms: cMs } = await callClova(fileData, mimeType)
          const { items, ms: pMs } = await callClaude(buildVocabOcrClovaPrompt(text), 'claude-haiku-4-5-20251001')
          results.clova = { items, rawText: text, ms: cMs + pMs }
          break
        }

        case 'claude-haiku': {
          if (!fileContent) { results['claude-haiku'] = { ms: 0, error: '이미지만 지원' }; break }
          const { items, ms } = await callClaude(VOCAB_OCR_VISION_PROMPT, 'claude-haiku-4-5-20251001', fileContent)
          results['claude-haiku'] = { items, ms }
          break
        }

        case 'claude-sonnet': {
          if (!fileContent) { results['claude-sonnet'] = { ms: 0, error: '이미지만 지원' }; break }
          const { items, ms } = await callClaude(VOCAB_OCR_VISION_PROMPT, 'claude-sonnet-4-6', fileContent)
          results['claude-sonnet'] = { items, ms }
          break
        }

        case 'claude-sonnet-enhanced': {
          if (!fileContent) { results['claude-sonnet-enhanced'] = { ms: 0, error: '이미지만 지원' }; break }
          const { items, ms } = await callClaude(ENHANCED_VISION_PROMPT, 'claude-sonnet-4-6', fileContent)
          results['claude-sonnet-enhanced'] = { items, ms }
          break
        }

        case 'clova-claude': {
          if (!fileContent) { results['clova-claude'] = { ms: 0, error: '이미지만 지원' }; break }
          const { text, ms: cMs } = await callClova(fileData, mimeType)
          const hybridPrompt = `CLOVA OCR이 단어 시험지를 읽은 결과입니다. 이미지를 함께 보고 오인식을 수정하세요.

CLOVA OCR 결과:
${text}

━━━ 수정 규칙 ━━━
- CLOVA 결과를 기본으로 사용하되, 이미지와 명백히 다른 경우만 수정
- 특히 ㅓ/ㅗ, 받침 오인식에 주의
- 판독 불가 → null, 미기재 → ""
- 학생 답을 교정·추측하지 마세요

JSON 배열만 출력:
[{"number":1,"english_word":"necessary","student_answer":"필수적인"}]`
          const { items, ms: pMs } = await callClaude(hybridPrompt, 'claude-sonnet-4-6', fileContent)
          results['clova-claude'] = { items, rawText: text, ms: cMs + pMs }
          break
        }

        case 'google': {
          const { text, ms: gMs } = await callGoogle(fileData)
          const { items, ms: pMs } = await callClaude(buildVocabOcrClovaPrompt(text), 'claude-haiku-4-5-20251001')
          results.google = { items, rawText: text, ms: gMs + pMs }
          break
        }
      }
    } catch (e: unknown) {
      results[test] = { ms: 0, error: e instanceof Error ? e.message : String(e) }
    }
  })

  await Promise.all(runners)

  return ok({ results })
}
