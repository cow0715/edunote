import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'
import { err, getAuth, ok } from '@/lib/api'
import { parseWeekProblemSheetPage, type WeekProblemSheetQuestion } from '@/lib/anthropic'
import { extractPdfText } from '@/lib/week-reading-import'

export const maxDuration = 300

type CompareMode = 'direct-pdf' | 'local-text' | 'hybrid'

export type PdfImportCompareResult = {
  mode: CompareMode
  ok: boolean
  durationMs: number
  questionCount: number
  questions: WeekProblemSheetQuestion[]
  inputTokens?: number
  outputTokens?: number
  extractedTextChars?: number
  extractedTextPreview?: string
  error?: string
}

export type PdfImportCompareResponse = {
  fileName: string
  originalPageCount: number
  testedPageCount: number
  maxPages: number
  results: Partial<Record<CompareMode, PdfImportCompareResult>>
}

let anthropicClient: Anthropic | null = null

function getAnthropic() {
  anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return anthropicClient
}

async function getPdfPageCount(fileData: string) {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.load(Buffer.from(fileData, 'base64'))
  return pdf.getPageCount()
}

async function slicePdfFirstPages(fileData: string, maxPages: number) {
  const { PDFDocument } = await import('pdf-lib')
  const sourcePdf = await PDFDocument.load(Buffer.from(fileData, 'base64'))
  const pageCount = sourcePdf.getPageCount()
  const testedPageCount = Math.min(Math.max(1, maxPages), pageCount)

  if (testedPageCount === pageCount) {
    return { fileData, originalPageCount: pageCount, testedPageCount }
  }

  const sliced = await PDFDocument.create()
  const copied = await sliced.copyPages(
    sourcePdf,
    Array.from({ length: testedPageCount }, (_, index) => index),
  )
  copied.forEach((page) => sliced.addPage(page))

  const bytes = await sliced.save()
  return {
    fileData: Buffer.from(bytes).toString('base64'),
    originalPageCount: pageCount,
    testedPageCount,
  }
}

function parseJsonArray(raw: string): WeekProblemSheetQuestion[] {
  return JSON.parse(jsonrepair(raw.replace(/```json\n?|\n?```/g, '').trim())) as WeekProblemSheetQuestion[]
}

function buildTextParsePrompt(rawText: string) {
  return `You are parsing an English problem-sheet PDF from locally extracted text.
Return only a JSON array. Do not include markdown.

The local text extraction may flatten columns, tables, and boxed layouts. Preserve question order as best as possible, but mark needs_source_image=true when the text is not enough to represent a question safely.

Output fields for every question:
- question_number: number
- question_type: string or null
- question_style: "objective" | "subjective" | "ox" | "multi_select"
- passage: full passage text, or ""
- question_text: question stem and instructions
- choices: array of answer choices. Keep original choice markers when visible.
- needs_source_image: boolean
- source_image_reason: "table" | "chart" | "diagram" | "layout" | "image" | null
- source_page: null
- source_bbox: null

Rules:
- Ignore answer keys and explanation sections.
- Do not invent missing answers.
- Do not skip visible questions.
- If two-column reading order looks suspicious, still parse what is visible and set needs_source_image=true with source_image_reason="layout".
- If a table, chart, diagram, or image is required, set needs_source_image=true.

Extracted text:
${rawText}`
}

function buildHybridPrompt(rawText: string) {
  return `${buildTextParsePrompt(rawText)}

You also have the original PDF attached. Use the PDF as the source of truth when local text order, choices, tables, or images conflict with the extracted text.`
}

async function parseLocalText(rawText: string, mode: CompareMode, fileData?: string) {
  const start = Date.now()
  const content: Anthropic.MessageParam['content'] = mode === 'hybrid' && fileData
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } },
        { type: 'text', text: buildHybridPrompt(rawText) },
      ]
    : buildTextParsePrompt(rawText)

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16384,
    messages: [{ role: 'user', content }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  const questions = parseJsonArray(raw)

  return {
    mode,
    ok: true,
    durationMs: Date.now() - start,
    questionCount: questions.length,
    questions,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    extractedTextChars: rawText.length,
    extractedTextPreview: rawText.slice(0, 4000),
  } satisfies PdfImportCompareResult
}

async function runMode(mode: CompareMode, fileData: string): Promise<PdfImportCompareResult> {
  const start = Date.now()

  try {
    if (mode === 'direct-pdf') {
      const questions = await parseWeekProblemSheetPage(fileData, 'application/pdf')
      return {
        mode,
        ok: true,
        durationMs: Date.now() - start,
        questionCount: questions.length,
        questions,
      }
    }

    const rawText = await extractPdfText(fileData)
    if (!rawText.trim()) {
      throw new Error('Local text extraction returned empty text.')
    }

    return await parseLocalText(rawText, mode, mode === 'hybrid' ? fileData : undefined)
  } catch (error) {
    return {
      mode,
      ok: false,
      durationMs: Date.now() - start,
      questionCount: 0,
      questions: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function POST(request: Request) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const body = await request.json() as {
    fileData?: string
    mimeType?: string
    fileName?: string
    maxPages?: number
    modes?: CompareMode[]
  }

  if (!body.fileData || body.mimeType !== 'application/pdf') {
    return err('PDF 파일만 테스트할 수 있습니다.')
  }

  const requestedModes = (body.modes?.length ? body.modes : ['direct-pdf', 'local-text']) as CompareMode[]
  const modes = requestedModes.filter((mode) => ['direct-pdf', 'local-text', 'hybrid'].includes(mode))
  if (!modes.length) return err('테스트 모드를 하나 이상 선택해 주세요.')

  const maxPages = Math.min(Math.max(Number(body.maxPages ?? 3), 1), 20)
  const originalPageCount = await getPdfPageCount(body.fileData)
  const sliced = await slicePdfFirstPages(body.fileData, maxPages)
  const results: PdfImportCompareResponse['results'] = {}

  await Promise.all(modes.map(async (mode) => {
    results[mode] = await runMode(mode, sliced.fileData)
  }))

  return ok({
    fileName: body.fileName ?? 'sample.pdf',
    originalPageCount,
    testedPageCount: sliced.testedPageCount,
    maxPages,
    results,
  } satisfies PdfImportCompareResponse)
}
