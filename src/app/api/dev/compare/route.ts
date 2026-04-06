import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'
import {
  PARSE_ANSWER_SHEET_RULES,
  EXAM_BANK_PARSE_RULES,
  VOCAB_PDF_PROMPT,
  buildVocabGradingPrompt,
} from '@/lib/prompts'
import { err, ok, getAuth } from '@/lib/api'

export const maxDuration = 300

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
}

function calcCost(model: string, inputTokens: number, outputTokens: number) {
  const p = PRICES[model]
  if (!p) return 0
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFileContent(fileData: string, mimeType: string): any {
  if (mimeType.startsWith('image/')) {
    return { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileData } }
  }
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } }
}

function parseJson(raw: string): unknown {
  return JSON.parse(jsonrepair(raw.replace(/```json\n?|\n?```/g, '').trim()))
}

export async function POST(request: NextRequest) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const body = await request.json()
  const { fn, model, fileData, mimeType, jsonInput } = body

  if (!PRICES[model]) return err('지원하지 않는 모델')

  const start = Date.now()

  try {
    let result: unknown
    let usage: { input_tokens: number; output_tokens: number }

    switch (fn) {
      case 'parseAnswerSheet': {
        if (!fileData || !mimeType) throw new Error('파일 필요')
        const fileContent = makeFileContent(fileData, mimeType)
        const prompt = `이 답안해설지에서 각 문항의 정답과 해설을 추출하세요.

${PARSE_ANSWER_SHEET_RULES}
- question_type: 해설지에 명시된 문제 유형명 한국어 추출. 없으면 null.

JSON 배열만 출력 (다른 텍스트 없이):
[{"question_number":1,"sub_label":null,"question_style":"objective","question_type":"가정법","correct_answer":3,"correct_answer_text":null,"grading_criteria":null,"explanation":"...","question_text":"..."}]`
        const res = await client.messages.create({
          model,
          max_tokens: 16384,
          messages: [{ role: 'user', content: [fileContent, { type: 'text', text: prompt }] }],
        })
        usage = res.usage
        result = parseJson(res.content[0].type === 'text' ? res.content[0].text : '')
        break
      }

      case 'parseExamBankPage': {
        if (!fileData || !mimeType) throw new Error('파일 필요')
        const fileContent = makeFileContent(fileData, mimeType)
        const res = await client.messages.create({
          model,
          max_tokens: 32768,
          messages: [{ role: 'user', content: [fileContent, { type: 'text', text: EXAM_BANK_PARSE_RULES }] }],
        })
        usage = res.usage
        result = parseJson(res.content[0].type === 'text' ? res.content[0].text : '')
        break
      }

      case 'parseVocabPdf': {
        if (!fileData || !mimeType) throw new Error('파일 필요')
        const fileContent = makeFileContent(fileData, mimeType)
        const res = await client.messages.create({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: [fileContent, { type: 'text', text: VOCAB_PDF_PROMPT }] }],
        })
        usage = res.usage
        result = parseJson(res.content[0].type === 'text' ? res.content[0].text : '')
        break
      }

      case 'gradeVocabItems': {
        if (!jsonInput) throw new Error('JSON 입력 필요')
        const items = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput
        const prompt = buildVocabGradingPrompt(items)
        const res = await client.messages.create({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        })
        usage = res.usage
        result = parseJson(res.content[0].type === 'text' ? res.content[0].text : '')
        break
      }

      default:
        throw new Error(`지원하지 않는 함수: ${fn}`)
    }

    return ok({
      result,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost: calcCost(model, usage.input_tokens, usage.output_tokens),
      durationMs: Date.now() - start,
    })
  } catch (e: unknown) {
    return ok({
      error: e instanceof Error ? e.message : String(e),
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      durationMs: Date.now() - start,
    })
  }
}
