import type { SupabaseServerClient } from '@/lib/api'
import { buildQuestionTextFromParts, ensureChoiceMarker } from '@/lib/question-structure'
import {
  generateExplanations,
  gradeSubjectiveAnswers,
  parseProblemSheetAnswerKey,
  parseProblemSheetAnswerKeyFile,
  parseWeekProblemSheetPage,
} from '@/lib/anthropic'
import type {
  ParsedAnswer,
  ProblemSheetAnswerKeyItem,
  SourceBBox,
  SubjectiveStudentAnswer,
  TagCategory,
  WeekProblemSheetQuestion,
} from '@/lib/anthropic'
import { recalcReadingCorrect, gradeMultiSelect, gradeOX } from '@/lib/grade-utils'

export type MatchTagId = (questionType: string | null) => string | null

export type TeacherTagContext = {
  tagList: { id: string; name: string }[]
  tagCategories: TagCategory[]
}

export type ReadingImportOutcome = {
  questions_parsed: number
  students_regraded: number
  subjective_grading_failed?: boolean
}

export type ProblemSheetUploadInput = {
  fileData?: string
  storagePath?: string
  mimeType: string
  fileName?: string
  pageOffset?: number
}

const PDF_PARSE_CHUNK_PAGES = 3

async function splitPdfUploadInput(
  file: ProblemSheetUploadInput,
  pagesPerChunk = PDF_PARSE_CHUNK_PAGES,
): Promise<ProblemSheetUploadInput[]> {
  if (file.mimeType !== 'application/pdf' || !file.fileData) {
    return [{ ...file, pageOffset: file.pageOffset ?? 0 }]
  }

  const { PDFDocument } = await import('pdf-lib')
  const sourcePdf = await PDFDocument.load(Buffer.from(file.fileData, 'base64'))
  const pageCount = sourcePdf.getPageCount()

  if (pageCount <= pagesPerChunk) {
    return [{ ...file, pageOffset: file.pageOffset ?? 0 }]
  }

  const chunks: ProblemSheetUploadInput[] = []
  for (let start = 0; start < pageCount; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, pageCount)
    const chunkPdf = await PDFDocument.create()
    const copiedPages = await chunkPdf.copyPages(
      sourcePdf,
      Array.from({ length: end - start }, (_, index) => start + index),
    )
    copiedPages.forEach((page) => chunkPdf.addPage(page))

    const chunkBytes = await chunkPdf.save()
    const pageLabel = `${start + 1}-${end}`
    chunks.push({
      fileData: Buffer.from(chunkBytes).toString('base64'),
      mimeType: 'application/pdf',
      fileName: file.fileName ? `${file.fileName}#p${pageLabel}` : `chunk-p${pageLabel}.pdf`,
      pageOffset: (file.pageOffset ?? 0) + start,
    })
  }

  console.log(`[week-reading-import] split PDF into ${chunks.length} chunks (${pageCount} pages)`)
  return chunks
}

async function splitProblemSheetUploadInputs(
  files: ProblemSheetUploadInput[],
): Promise<ProblemSheetUploadInput[]> {
  const chunks: ProblemSheetUploadInput[] = []
  for (const file of files) {
    chunks.push(...await splitPdfUploadInput(file))
  }
  return chunks
}

async function splitPdfUploadInputByPageCount(
  file: ProblemSheetUploadInput,
  pagesPerChunk: number,
): Promise<ProblemSheetUploadInput[]> {
  return splitPdfUploadInput(file, pagesPerChunk)
}

function coerceQuestionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string') {
    const match = value.match(/\d+/g)
    if (!match?.length) return null
    const parsed = Number.parseInt(match[match.length - 1], 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function coerceCorrectAnswer(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string') {
    const match = value.match(/\d+/)
    if (!match) return 0
    const parsed = Number.parseInt(match[0], 10)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function normalizeSourceBBox(value: unknown): SourceBBox | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<Record<keyof SourceBBox, unknown>>
  const x = typeof candidate.x === 'number' ? candidate.x : Number(candidate.x)
  const y = typeof candidate.y === 'number' ? candidate.y : Number(candidate.y)
  const width = typeof candidate.width === 'number' ? candidate.width : Number(candidate.width)
  const height = typeof candidate.height === 'number' ? candidate.height : Number(candidate.height)

  if (![x, y, width, height].every(Number.isFinite)) return null
  if (width <= 0 || height <= 0) return null
  if (x >= 1 || y >= 1 || x + width <= 0 || y + height <= 0) return null

  const left = Math.max(0, Math.min(1, x))
  const top = Math.max(0, Math.min(1, y))
  const right = Math.max(left, Math.min(1, x + width))
  const bottom = Math.max(top, Math.min(1, y + height))
  if (right - left <= 0.01 || bottom - top <= 0.01) return null

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function shouldStoreSourceImage(question: Pick<WeekProblemSheetQuestion, 'needs_source_image' | 'source_image_reason'>): boolean {
  const reason = question.source_image_reason?.toLowerCase() ?? ''
  return question.needs_source_image === true &&
    ['table', 'chart', 'diagram', 'layout', 'image'].includes(reason)
}

function stripGlossaryBoldMarkup(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const isGlossaryLine = /^\s*\*[\p{L}\p{N}]/u.test(line) || /\s\*[\p{L}\p{N}]/u.test(line)
      if (isGlossaryLine) return line
      if (!isGlossaryLine) return line.replace(/(^|\s)\*\s*\*\*([^*\n]+?)\*\*/g, '$1*$2')
    })
    .join('\n')
}

function stripUnderlineMarkup(text: string): string {
  return text.replace(/<u>([\s\S]*?)<\/u>/g, '$1')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripChoiceMarker(choice: string): string {
  return stripUnderlineMarkup(choice)
    .replace(/\*\*/g, '')
    .replace(/^\s*(?:\d+[.)]\s*)?[①②③④⑤⑥⑦⑧⑨⑩]?\s*/, '')
    .trim()
}

function underlinePassageChoices(text: string, choices: string[]): string {
  let next = text
  for (let index = 0; index < choices.length; index += 1) {
    const word = stripChoiceMarker(choices[index])
    if (!word) continue
    const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'][index]
    if (!circled) continue

    const plainPattern = new RegExp(`(${escapeRegExp(circled)}\\s*)(?!<u>)(${escapeRegExp(word)})(?!</u>)`, 'g')
    next = next.replace(plainPattern, `$1<u>$2</u>`)
  }
  return next
}

function normalizeQuestionVisualMarkup(question: {
  question_text: string
  passage: string
  choices: string[]
}): { question_text: string; passage: string; choices: string[] } {
  const asksUnderlinedWord = /밑줄\s*친|낱말의\s*쓰임|문맥상\s*낱말/.test(question.question_text)
  const choices = question.choices.map((choice) => stripGlossaryBoldMarkup(asksUnderlinedWord ? stripUnderlineMarkup(choice) : choice))
  let questionText = stripGlossaryBoldMarkup(question.question_text)
  let passage = stripGlossaryBoldMarkup(question.passage)

  if (asksUnderlinedWord && choices.length > 0) {
    questionText = underlinePassageChoices(questionText, choices)
    passage = underlinePassageChoices(passage, choices)
  }

  return { question_text: questionText, passage, choices }
}

function normalizeQuestionTextSpacing(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type QuestionRow = {
  id: string
  question_number: number
  sub_label: string | null
  question_style: string
  correct_answer: number
  correct_answer_text: string | null
  grading_criteria: string | null
}

export async function fetchTeacherTagContext(
  supabase: SupabaseServerClient,
  teacherId: string | null,
): Promise<TeacherTagContext> {
  if (!teacherId) {
    return { tagList: [], tagCategories: [] }
  }

  const tagList: { id: string; name: string }[] = []
  const tagCategories: TagCategory[] = []

  const { data: categories } = await supabase
    .from('concept_category')
    .select('id, name')
    .eq('teacher_id', teacherId)
    .order('sort_order')

  const { data: tags } = await supabase
    .from('concept_tag')
    .select('id, name, concept_category_id')
    .eq('teacher_id', teacherId)
    .order('sort_order')

  for (const tag of tags ?? []) {
    tagList.push({ id: tag.id, name: tag.name })
  }

  for (const category of categories ?? []) {
    const categoryTags = (tags ?? [])
      .filter((tag) => tag.concept_category_id === category.id)
      .map((tag) => tag.name)
    if (categoryTags.length > 0) {
      tagCategories.push({ categoryName: category.name, tags: categoryTags })
    }
  }

  return { tagList, tagCategories }
}

export function createTagMatcher(tagList: { id: string; name: string }[]): MatchTagId {
  return (questionType: string | null) => {
    if (!questionType) return null

    const exact = tagList.find((tag) => tag.name === questionType)
    if (exact) return exact.id

    const normalizedQuestionType = questionType.replace(/\s/g, '').toLowerCase()
    const normalizedTag = tagList.find(
      (tag) => tag.name.replace(/\s/g, '').toLowerCase() === normalizedQuestionType,
    )
    return normalizedTag?.id ?? null
  }
}

export function normalizeParsedAnswers(parsedAnswers: ParsedAnswer[]): ParsedAnswer[] {
  const sanitized = parsedAnswers
    .map((answer) => {
      const questionNumber = coerceQuestionNumber(answer.question_number)
      if (!questionNumber) return null

      return {
        ...answer,
        question_number: questionNumber,
        correct_answer: coerceCorrectAnswer(answer.correct_answer),
        sub_label: answer.sub_label ? String(answer.sub_label).trim() || null : null,
      }
    })
    .filter((answer): answer is ParsedAnswer => answer !== null)

  const grouped = new Map<number, ParsedAnswer[]>()
  for (const answer of sanitized) {
    const arr = grouped.get(answer.question_number) ?? []
    arr.push(answer)
    grouped.set(answer.question_number, arr)
  }

  const normalized: ParsedAnswer[] = []
  for (const [, group] of grouped) {
    const collapsed = collapseSplitObjectiveQuestion(group)
    if (collapsed) {
      normalized.push(collapsed)
      continue
    }

    const hasFindError = group.some((g) => g.question_style === 'find_error')
    if (group.length === 1 || hasFindError) {
      normalized.push(...group)
      continue
    }

    const sorted = [...group].sort((x, y) => (x.sub_label ?? '').localeCompare(y.sub_label ?? ''))
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'
    sorted.forEach((item, index) => {
      normalized.push({ ...item, sub_label: alphabet[index] })
    })
  }

  return normalized
}

function collapseSplitObjectiveQuestion(group: ParsedAnswer[]): ParsedAnswer | null {
  if (group.length < 2) return null

  const objectiveAnswers = group.filter(
    (answer) => answer.question_style === 'objective' && answer.correct_answer >= 1 && answer.correct_answer <= 5,
  )
  if (objectiveAnswers.length !== 1) return null

  const objective = objectiveAnswers[0]
  const nonObjectiveAnswers = group.filter((answer) => answer !== objective)
  if (!nonObjectiveAnswers.every((answer) => answer.question_style === 'subjective')) return null

  const text = [
    objective.question_text,
    objective.explanation,
    ...nonObjectiveAnswers.flatMap((answer) => [
      answer.question_text,
      answer.correct_answer_text,
      answer.explanation,
      answer.grading_criteria,
    ]),
  ]
    .filter(Boolean)
    .join('\n')

  if (!looksLikeSummaryBlankObjective(text)) return null

  return {
    ...objective,
    sub_label: null,
  }
}

function looksLikeSummaryBlankObjective(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ')

  const hasBlankLabels =
    /\(\s*A\s*\)/i.test(normalized) &&
    /\(\s*B\s*\)/i.test(normalized)
  const hasChoiceMarker = /[①②③④⑤]/.test(normalized) || /(?:^|\s)[1-5][.)]\s+\S/.test(normalized)
  const asksBestChoice =
    /가장\s*적절한\s*것/.test(normalized) ||
    /가장\s*알맞은\s*것/.test(normalized) ||
    /들어갈\s*말/.test(normalized)

  return hasBlankLabels && hasChoiceMarker && asksBestChoice
}

export async function extractPdfText(fileData: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const buffer = Buffer.from(fileData, 'base64')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return String(text || '')
}

export function looksLikeProblemSheetPdf(rawText: string): boolean {
  const answerMatches = rawText.match(/정답/g) ?? []
  const explanationMatches = rawText.match(/해설|출제의도|\[정답\]/g) ?? []
  return answerMatches.length >= 8 && explanationMatches.length <= 1
}

function normalizeProblemSheetQuestions(questions: WeekProblemSheetQuestion[]): WeekProblemSheetQuestion[] {
  const usedNumbers = new Set<number>()
  let fallbackNumber = 1

  return questions.map((question) => {
    let questionNumber = coerceQuestionNumber(question.question_number)

    if (!questionNumber || usedNumbers.has(questionNumber)) {
      while (usedNumbers.has(fallbackNumber)) {
        fallbackNumber += 1
      }
      questionNumber = fallbackNumber
    }

    usedNumbers.add(questionNumber)
    if (questionNumber >= fallbackNumber) {
      fallbackNumber = questionNumber + 1
    }

    return {
      ...question,
      question_number: questionNumber,
    }
  })
}

async function parseProblemSheetQuestionInputs(
  files: ProblemSheetUploadInput[],
  tagCategories: TagCategory[] = [],
): Promise<WeekProblemSheetQuestion[]> {
  const collected: WeekProblemSheetQuestion[] = []

  const normalizeParsedForFile = (
    parsed: WeekProblemSheetQuestion[],
    file: ProblemSheetUploadInput,
  ) => parsed
    .map((question): WeekProblemSheetQuestion | null => {
      const questionNumber = coerceQuestionNumber(question.question_number)
      if (!questionNumber) return null
      const localSourcePage = coerceQuestionNumber(question.source_page)
      const sourceBBox = normalizeSourceBBox(question.source_bbox)

      return {
        ...question,
        question_number: questionNumber,
        question_style: normalizeQuestionStyle(question.question_style),
        source_page: localSourcePage ? (file.pageOffset ?? 0) + localSourcePage : null,
        source_bbox: sourceBBox,
      }
    })
    .filter((question): question is WeekProblemSheetQuestion => question !== null)

  const parseFiles = await splitProblemSheetUploadInputs(files)
  for (const file of parseFiles) {
    if (!file.fileData) {
      throw new Error('업로드 파일 데이터를 읽지 못했습니다.')
    }
    let parsed: WeekProblemSheetQuestion[]
    try {
      parsed = await parseWeekProblemSheetPage(file.fileData, file.mimeType, tagCategories)
    } catch (error) {
      const fallbackFiles = await splitPdfUploadInputByPageCount(file, 1)
      if (fallbackFiles.length <= 1) throw error
      console.warn('[week-reading-import] chunk parse failed; retrying page-by-page:', error)
      const fallbackParsed: WeekProblemSheetQuestion[] = []
      for (const fallbackFile of fallbackFiles) {
        if (!fallbackFile.fileData) continue
        const fallbackPage = await parseWeekProblemSheetPage(fallbackFile.fileData, fallbackFile.mimeType, tagCategories)
        fallbackParsed.push(...normalizeParsedForFile(fallbackPage, fallbackFile))
      }
      collected.push(...fallbackParsed)
      continue
    }
    collected.push(...normalizeParsedForFile(parsed, file))
  }

  return normalizeProblemSheetQuestions(collected)
}

function normalizeQuestionStyle(
  style: string | null | undefined,
): 'objective' | 'subjective' | 'ox' | 'multi_select' {
  if (style === 'subjective' || style === 'ox' || style === 'multi_select') return style
  return 'objective'
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function findLikelyAnswerSection(rawText: string): string {
  const normalized = rawText.replace(/\r/g, '')
  const markers = ['객관식 정답', '정답 영역', '정답표', '서답형 정답', '정답']

  let start = -1
  for (const marker of markers) {
    const idx = normalized.lastIndexOf(marker)
    if (idx > start) start = idx
  }

  if (start >= 0) {
    return normalized.slice(start)
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length <= 12) {
    return normalized
  }

  return lines.slice(Math.floor(lines.length * 0.65)).join('\n')
}

function parseChoiceToken(token: string): number {
  const trimmed = token.trim()
  if (!trimmed) return 0

  const symbolMap: Record<string, number> = {
    '①': 1,
    '②': 2,
    '③': 3,
    '④': 4,
    '⑤': 5,
  }
  if (symbolMap[trimmed]) return symbolMap[trimmed]

  const digit = trimmed.match(/\d/)
  if (!digit) return 0
  const parsed = Number.parseInt(digit[0], 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildRuleBasedAnswerKey(
  rawText: string,
  questions: WeekProblemSheetQuestion[],
): ProblemSheetAnswerKeyItem[] {
  const answerSection = findLikelyAnswerSection(rawText)
  const lines = answerSection
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean)

  const byNumber = new Map(questions.map((question) => [question.question_number, question]))
  const subjectiveQuestions = questions.filter((question) => normalizeQuestionStyle(question.question_style) === 'subjective')
  const resultMap = new Map<number, ProblemSheetAnswerKeyItem>()

  for (const line of lines) {
    const numericMatch = line.match(/^(\d+)\s*[.)]\s*(.+)$/)
    if (numericMatch) {
      const questionNumber = Number.parseInt(numericMatch[1], 10)
      const payload = numericMatch[2].trim()
      const question = byNumber.get(questionNumber)
      if (!question) continue

      const style = normalizeQuestionStyle(question.question_style)
      if (style === 'objective') {
        const correctAnswer = parseChoiceToken(payload)
        if (correctAnswer > 0) {
          resultMap.set(questionNumber, {
            question_number: questionNumber,
            question_style: style,
            correct_answer: correctAnswer,
            correct_answer_text: null,
          })
        }
        continue
      }

      if (style === 'multi_select') {
        const picks = payload.match(/\d+/g)?.join(',')
        if (picks) {
          resultMap.set(questionNumber, {
            question_number: questionNumber,
            question_style: style,
            correct_answer: 0,
            correct_answer_text: picks,
          })
        }
        continue
      }

      if (style === 'ox') {
        const ox = payload.match(/^([OX])(?:\s*\((.+)\))?$/i)
        if (ox) {
          resultMap.set(questionNumber, {
            question_number: questionNumber,
            question_style: style,
            correct_answer: 0,
            correct_answer_text: ox[2] ? `${ox[1].toUpperCase()} (${ox[2].trim()})` : ox[1].toUpperCase(),
          })
        }
        continue
      }

      if (payload) {
        resultMap.set(questionNumber, {
          question_number: questionNumber,
          question_style: style,
          correct_answer: 0,
          correct_answer_text: payload,
        })
      }
      continue
    }

    const subjectiveMatch = line.match(/^(?:서답형|주관식|서술형|S)\s*(\d+)\s*[.)]?\s*(.+)$/i)
    if (subjectiveMatch) {
      const subjectiveIndex = Number.parseInt(subjectiveMatch[1], 10) - 1
      const target = subjectiveQuestions[subjectiveIndex]
      const payload = subjectiveMatch[2]?.trim()
      if (!target || !payload) continue

      resultMap.set(target.question_number, {
        question_number: target.question_number,
        question_style: 'subjective',
        correct_answer: 0,
        correct_answer_text: payload,
      })
    }
  }

  return questions
    .map((question) => resultMap.get(question.question_number))
    .filter((item): item is ProblemSheetAnswerKeyItem => item !== undefined)
}

function buildStoredQuestionText(question: {
  question_text: string
  passage: string
  choices: string[]
}): string | null {
  const parts = buildStructuredQuestionParts(question)
  return buildQuestionTextFromParts({
    questionStem: parts.question_stem,
    passage: parts.passage,
    choices: parts.choices,
  })
}

function buildStructuredQuestionParts(question: {
  question_text: string
  passage: string
  choices: string[]
}) {
  const normalized = normalizeQuestionVisualMarkup(question)
  return {
    question_stem: normalizeQuestionTextSpacing(normalized.question_text) || null,
    passage: normalizeQuestionTextSpacing(normalized.passage) || null,
    choices: normalized.choices
      .map((choice, index) => ensureChoiceMarker(normalizeQuestionTextSpacing(choice), index))
      .filter(Boolean),
  }
}

function extractChoicesFromStoredQuestionText(raw: string | null): string[] {
  return (raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^\d+\.\s+/, '').trim())
}

function buildExplanationAnswer(
  question: { choices: string[] },
  answer: {
    question_style: ParsedAnswer['question_style']
    correct_answer: number
    correct_answer_text: string | null
  },
): string {
  if (answer.question_style === 'objective' && answer.correct_answer > 0) {
    const choiceText = question.choices[answer.correct_answer - 1]
    return choiceText ? `${answer.correct_answer}. ${choiceText}` : String(answer.correct_answer)
  }

  return answer.correct_answer_text ?? ''
}

async function generateProblemSheetExplanations(
  merged: Array<{
    question: WeekProblemSheetQuestion
    answer: {
      question_style: ParsedAnswer['question_style']
      correct_answer: number
      correct_answer_text: string | null
    }
  }>,
): Promise<Map<number, string>> {
  const chunkSize = 6
  const chunks: typeof merged[] = []
  for (let i = 0; i < merged.length; i += chunkSize) {
    chunks.push(merged.slice(i, i + chunkSize))
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      generateExplanations(
        chunk.map(({ question, answer }) => ({
          question_number: question.question_number,
          passage: question.passage,
          question_text: question.question_text,
          choices: question.choices,
          answer: buildExplanationAnswer(question, answer),
        })),
        'standard',
      ),
    ),
  )

  return new Map(
    results.flat().map((item) => [
      item.question_number,
      item.solution || item.translation || item.intent || '',
    ]),
  )
}

export async function parseProblemSheetQuestionsOnly(
  files: ProblemSheetUploadInput[],
  tagCategories: TagCategory[] = [],
): Promise<ParsedAnswer[]> {
  if (!files.length) {
    throw new Error('시험지 파일이 없습니다.')
  }

  const questions = await parseProblemSheetQuestionInputs(files, tagCategories)

  if (!questions.length) {
    throw new Error('시험지에서 문항 구조를 찾지 못했습니다.')
  }

  return questions.map((question) => {
    const parts = buildStructuredQuestionParts(question)
    return {
      question_number: question.question_number,
      sub_label: null,
      question_style: question.question_style,
      question_type: question.question_type,
      correct_answer: 0,
      correct_answer_text: null,
      grading_criteria: null,
      explanation: null,
      question_text: buildStoredQuestionText(question),
      question_stem: parts.question_stem,
      passage: parts.passage,
      choices: parts.choices,
      needs_source_image: shouldStoreSourceImage(question),
      source_image_reason: question.source_image_reason ?? null,
      source_page: question.source_page ?? null,
      source_bbox: question.source_bbox ?? null,
    }
  })
}

export async function parseProblemSheetQuestionsWithOptionalAnswers(
  files: ProblemSheetUploadInput[],
  tagCategories: TagCategory[] = [],
): Promise<{ parsedAnswers: ParsedAnswer[]; answerKeyApplied: boolean }> {
  const parsedQuestions = await parseProblemSheetQuestionsOnly(files, tagCategories)
  const questionInputs = parsedQuestions.map((question) => ({
    question_number: question.question_number,
    question_type: question.question_type,
    question_style: normalizeQuestionStyle(question.question_style),
    passage: question.passage ?? '',
    question_text: question.question_stem ?? question.question_text ?? '',
    choices: question.choices ?? extractChoicesFromStoredQuestionText(question.question_text),
  }))

  const mergedItems = new Map<number, ProblemSheetAnswerKeyItem>()
  for (const file of await splitProblemSheetUploadInputs(files)) {
    if (!file.fileData) continue
    try {
      const items = await parseProblemSheetAnswerKeyFile(file.fileData, file.mimeType, questionInputs)
      for (const item of items) {
        const questionNumber = coerceQuestionNumber(item.question_number)
        if (!questionNumber) continue
        mergedItems.set(questionNumber, {
          ...item,
          question_number: questionNumber,
          correct_answer: coerceCorrectAnswer(item.correct_answer),
        })
      }
    } catch (error) {
      console.warn('[week-reading-import] optional answer key extraction skipped:', error)
    }
  }

  if (mergedItems.size === 0) {
    return { parsedAnswers: parsedQuestions, answerKeyApplied: false }
  }

  return {
    parsedAnswers: parsedQuestions.map((question) => {
      const answer = mergedItems.get(question.question_number)
      if (!answer) return question
      return {
        ...question,
        question_style: normalizeQuestionStyle(answer.question_style ?? question.question_style),
        correct_answer: coerceCorrectAnswer(answer.correct_answer),
        correct_answer_text: answer.correct_answer_text ?? null,
      }
    }),
    answerKeyApplied: true,
  }
}

export async function parseProblemSheetAnswers(
  fileData: string,
  mimeType: string,
  options?: {
    rawText?: string
    includeExplanations?: boolean
  },
): Promise<ParsedAnswer[]> {
  if (mimeType !== 'application/pdf') {
    throw new Error('문제지형 가져오기는 현재 PDF만 지원합니다.')
  }

  const questions = await parseProblemSheetQuestionInputs([{ fileData, mimeType }])

  if (!questions.length) {
    throw new Error('문제지에서 문항 구조를 찾지 못했습니다.')
  }

  const rawText = options?.rawText ?? await extractPdfText(fileData)
  if (!rawText.trim()) {
    throw new Error('문제지 PDF에서 텍스트를 추출하지 못했습니다.')
  }

  const ruleBasedAnswerKey = buildRuleBasedAnswerKey(rawText, questions)
  let answerKey = ruleBasedAnswerKey

  if (answerKey.length < questions.length) {
    const aiAnswerKey = (await parseProblemSheetAnswerKey(rawText, questions))
      .map((item) => {
        const questionNumber = coerceQuestionNumber(item.question_number)
        if (!questionNumber) return null

        return {
          ...item,
          question_number: questionNumber,
          correct_answer: coerceCorrectAnswer(item.correct_answer),
        }
      })
      .filter((item): item is ProblemSheetAnswerKeyItem => item !== null)

    const mergedAnswerKey = new Map<number, ProblemSheetAnswerKeyItem>()
    for (const item of aiAnswerKey) mergedAnswerKey.set(item.question_number, item)
    for (const item of ruleBasedAnswerKey) mergedAnswerKey.set(item.question_number, item)
    answerKey = questions
      .map((question) => mergedAnswerKey.get(question.question_number))
      .filter((item): item is ProblemSheetAnswerKeyItem => item !== undefined)
  }

  if (!answerKey.length) {
    throw new Error('문제지 PDF에서 정답 표기를 찾지 못했습니다.')
  }

  const answerMap = new Map(answerKey.map((item) => [item.question_number, item]))
  const merged = questions
    .filter((question) => answerMap.has(question.question_number))
    .map((question) => ({ question, answer: answerMap.get(question.question_number)! }))

  if (!merged.length) {
    throw new Error('문항과 정답을 매핑하지 못했습니다.')
  }

  let explanations = new Map<number, string>()
  if (options?.includeExplanations) {
    try {
      explanations = await generateProblemSheetExplanations(merged)
    } catch (error) {
      console.error('[week-reading-import] problem_sheet explanation generation failed:', error)
    }
  }

  return merged.map(({ question, answer }) => ({
    question_number: question.question_number,
    sub_label: null,
    question_style: answer.question_style ?? question.question_style,
    question_type: question.question_type,
    correct_answer: answer.correct_answer,
    correct_answer_text: answer.correct_answer_text,
    grading_criteria: null,
    explanation: explanations.get(question.question_number) || null,
    question_text: buildStoredQuestionText(question),
  }))
}

export async function parseProblemSheetAnswerKeyOnly(params: {
  supabase: SupabaseServerClient
  weekId: string
  files: ProblemSheetUploadInput[]
}): Promise<ParsedAnswer[]> {
  const { supabase, weekId, files } = params
  if (!files.length) {
    throw new Error('정오표 파일이 없습니다.')
  }

  const { data: existingQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label, question_style, question_text')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')
    .order('sub_label', { nullsFirst: true })

  if (!existingQuestions?.length) {
    throw new Error('먼저 시험지 PDF를 업로드해 문항을 저장해주세요.')
  }

  const answerableQuestionCount = existingQuestions.filter(
    (question) => (question.sub_label ?? null) === null,
  ).length

  const questions: WeekProblemSheetQuestion[] = existingQuestions.map((question) => ({
    question_number: question.question_number,
    question_type: null,
    question_style: normalizeQuestionStyle(question.question_style),
    passage: '',
    question_text: question.question_text ?? '',
    choices: extractChoicesFromStoredQuestionText(question.question_text),
  }))

  const mergedItems = new Map<number, ProblemSheetAnswerKeyItem>()
  const parseFiles = await splitProblemSheetUploadInputs(files)
  for (const file of parseFiles) {
    if (!file.fileData) {
      throw new Error('업로드 파일 데이터를 읽지 못했습니다.')
    }
    const items = await parseProblemSheetAnswerKeyFile(file.fileData, file.mimeType, questions)
    for (const item of items) {
      const questionNumber = coerceQuestionNumber(item.question_number)
      if (!questionNumber) continue
      mergedItems.set(questionNumber, {
        ...item,
        question_number: questionNumber,
        correct_answer: coerceCorrectAnswer(item.correct_answer),
      })
    }
  }

  const parsed: ParsedAnswer[] = [...mergedItems.values()]
    .map((item): ParsedAnswer | null => {
      const questionNumber = coerceQuestionNumber(item.question_number)
      if (!questionNumber) return null

      const existing = existingQuestions.find(
        (question) => question.question_number === questionNumber && (question.sub_label ?? null) === null,
      )
      if (!existing) return null

      return {
        question_number: questionNumber,
        sub_label: null,
        question_style: normalizeQuestionStyle(item.question_style ?? existing.question_style),
        question_type: null,
        correct_answer: coerceCorrectAnswer(item.correct_answer),
        correct_answer_text: item.correct_answer_text ?? null,
        grading_criteria: null,
        explanation: null,
        question_text: existing.question_text ?? null,
      }
    })
    .filter((item): item is ParsedAnswer => item !== null)

  if (!parsed.length) {
    throw new Error('정오표에서 적용할 정답을 찾지 못했습니다.')
  }

  if (answerableQuestionCount > 0 && parsed.length !== answerableQuestionCount) {
    throw new Error(
      `정오표에서 ${parsed.length}/${answerableQuestionCount}문항만 읽혔습니다. ` +
      '현재 저장된 시험지 문항 수와 정오표 정답 수가 같아야 적용할 수 있습니다.',
    )
  }

  return parsed
}

export async function saveWeekAnswerSheetFile(
  supabase: SupabaseServerClient,
  weekId: string,
  fileData: string,
  mimeType: string,
  fileName?: string,
) {
  try {
    const safeName = (fileName as string | undefined)
      ?.replace(/[^\x00-\x7F]/g, '_')
      .replace(/[/\\?%*:|"<>\s]/g, '_')
      .replace(/_+/g, '_')
      ?? `${weekId}.bin`

    const fileBuffer = Buffer.from(fileData, 'base64')
    const { error: storageErr } = await supabase.storage
      .from('answer-sheets')
      .upload(safeName, fileBuffer, { contentType: mimeType, upsert: true })

    if (storageErr) {
      console.error('[week-reading-import] storage upload failed:', storageErr)
      return
    }

    await supabase.from('week').update({ answer_sheet_path: safeName }).eq('id', weekId)
  } catch (error) {
    console.error('[week-reading-import] storage save failed:', error)
  }
}

type SourceImageQuestionRow = {
  id: string
  question_number: number
  source_page: number | null
  source_bbox: SourceBBox | null
}

export type GenerateSourceImageQuestion = {
  id: string
  source_page: number | null
  source_bbox: SourceBBox | null
}

async function renderPdfPageToPng(
  fileData: string,
  pageNumber: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const canvasModule = await import('@napi-rs/canvas')
  const { createCanvas, DOMMatrix, ImageData, Path2D } = canvasModule
  const globalScope = globalThis as Record<string, unknown>
  globalScope.DOMMatrix ??= DOMMatrix
  globalScope.ImageData ??= ImageData
  globalScope.Path2D ??= Path2D

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const [{ join }, { pathToFileURL }] = await Promise.all([
    import('node:path'),
    import('node:url'),
  ])
  ;(pdfjs as any).GlobalWorkerOptions.workerSrc = pathToFileURL(
    join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href

  const pdfData = new Uint8Array(Buffer.from(fileData, 'base64'))
  class NapiCanvasFactory {
    create(width: number, height: number) {
      if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
      const canvas = createCanvas(width, height)
      return { canvas, context: canvas.getContext('2d') }
    }

    reset(canvasAndContext: { canvas: { width: number; height: number } | null }, width: number, height: number) {
      if (!canvasAndContext.canvas) throw new Error('Canvas is not specified')
      if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
      canvasAndContext.canvas.width = width
      canvasAndContext.canvas.height = height
    }

    destroy(canvasAndContext: { canvas: { width: number; height: number } | null; context: unknown }) {
      if (!canvasAndContext.canvas) return
      canvasAndContext.canvas.width = 0
      canvasAndContext.canvas.height = 0
      canvasAndContext.canvas = null
      canvasAndContext.context = null
    }
  }

  const pdf = await (pdfjs as any).getDocument({
    data: pdfData,
    CanvasFactory: NapiCanvasFactory,
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1.5 })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const canvasContext = canvas.getContext('2d')

  await page.render({ canvasContext: canvasContext as any, viewport }).promise
  return {
    buffer: canvas.toBuffer('image/png'),
    width: canvas.width,
    height: canvas.height,
  }
}

async function cropSourceImage(
  renderedPage: { buffer: Buffer; width: number; height: number },
  sourceBBox: SourceBBox | null,
): Promise<Buffer> {
  if (!sourceBBox) return renderedPage.buffer

  const paddingRatio = 0.04
  const left = Math.max(0, sourceBBox.x - paddingRatio)
  const top = Math.max(0, sourceBBox.y - paddingRatio)
  const right = Math.min(1, sourceBBox.x + sourceBBox.width + paddingRatio)
  const bottom = Math.min(1, sourceBBox.y + sourceBBox.height + paddingRatio)
  const crop = {
    left: Math.floor(left * renderedPage.width),
    top: Math.floor(top * renderedPage.height),
    width: Math.ceil((right - left) * renderedPage.width),
    height: Math.ceil((bottom - top) * renderedPage.height),
  }

  if (crop.width < 24 || crop.height < 24) return renderedPage.buffer

  try {
    const sharp = (await import('sharp')).default
    return await sharp(renderedPage.buffer)
      .extract(crop)
      .png()
      .toBuffer()
  } catch (error) {
    console.warn('[week-reading-import] source image crop failed, using full page:', error)
    return renderedPage.buffer
  }
}

export async function generateSourceImageForQuestion(
  supabase: SupabaseServerClient,
  weekId: string,
  fileData: string,
  question: GenerateSourceImageQuestion,
): Promise<{ storagePath: string | null; error: string | null }> {
  if (!question.source_page) {
    return { storagePath: null, error: 'source_page가 없습니다.' }
  }

  try {
    const renderedPage = await renderPdfPageToPng(fileData, question.source_page)
    const pngBuffer = await cropSourceImage(renderedPage, question.source_bbox)
    const suffix = question.source_bbox ? 'crop' : 'page'
    const storagePath = `source-images/${weekId}/${question.id}-p${question.source_page}-${suffix}.png`
    const { error: uploadError } = await supabase.storage
      .from('answer-sheets')
      .upload(storagePath, pngBuffer, { contentType: 'image/png', upsert: true })

    if (uploadError) {
      return { storagePath: null, error: uploadError.message }
    }

    const { error: updateError } = await supabase
      .from('exam_question')
      .update({ source_image_path: storagePath })
      .eq('id', question.id)

    if (updateError) {
      return { storagePath: null, error: updateError.message }
    }

    return { storagePath, error: null }
  } catch (error) {
    return { storagePath: null, error: error instanceof Error ? error.message : '원본 이미지 생성 실패' }
  }
}

export async function saveSourceImagesForQuestions(
  supabase: SupabaseServerClient,
  weekId: string,
  files: ProblemSheetUploadInput[],
): Promise<{ saved: number; failed: number }> {
  const { data: rows, error } = await supabase
    .from('exam_question')
    .select('id, question_number, source_page, source_bbox')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .eq('needs_source_image', true)
    .not('source_page', 'is', null)

  if (error) {
    console.warn('[week-reading-import] source image question lookup failed:', error)
    return { saved: 0, failed: 0 }
  }

  const questions = (rows ?? []) as SourceImageQuestionRow[]
  if (questions.length === 0) return { saved: 0, failed: 0 }

  const bySourcePage = new Map<number, SourceImageQuestionRow[]>()
  for (const question of questions) {
    if (!question.source_page) continue
    const pageQuestions = bySourcePage.get(question.source_page) ?? []
    pageQuestions.push(question)
    bySourcePage.set(question.source_page, pageQuestions)
  }

  let saved = 0
  let failed = 0

  for (const file of files) {
    if (file.mimeType !== 'application/pdf' || !file.fileData) continue

    try {
      const { PDFDocument } = await import('pdf-lib')
      const sourcePdf = await PDFDocument.load(Buffer.from(file.fileData, 'base64'))
      const pageCount = sourcePdf.getPageCount()
      const pageOffset = file.pageOffset ?? 0

      for (let localPage = 1; localPage <= pageCount; localPage += 1) {
        const sourcePage = pageOffset + localPage
        const pageQuestions = bySourcePage.get(sourcePage)
        if (!pageQuestions?.length) continue

        try {
          const renderedPage = await renderPdfPageToPng(file.fileData, localPage)
          await Promise.all(pageQuestions.map(async (question) => {
            const pngBuffer = await cropSourceImage(renderedPage, question.source_bbox)
            const suffix = question.source_bbox ? 'crop' : 'page'
            const storagePath = `source-images/${weekId}/${question.id}-p${sourcePage}-${suffix}.png`
            const { error: uploadError } = await supabase.storage
              .from('answer-sheets')
              .upload(storagePath, pngBuffer, { contentType: 'image/png', upsert: true })

            if (uploadError) {
              failed += 1
              console.warn('[week-reading-import] source image upload failed:', uploadError)
              return
            }

            const { error: updateError } = await supabase
              .from('exam_question')
              .update({ source_image_path: storagePath })
              .eq('id', question.id)

            if (updateError) {
              failed += 1
              console.warn('[week-reading-import] source image path update failed:', updateError)
              return
            }

            saved += 1
          }))
        } catch (pageRenderError) {
          failed += pageQuestions.length
          console.warn(`[week-reading-import] source image render skipped for page ${sourcePage}:`, pageRenderError)
        }
      }
    } catch (renderError) {
      failed += questions.length
      console.warn('[week-reading-import] source image render skipped:', renderError)
    }
  }

  return { saved, failed }
}

export async function syncWeekReadingQuestionsAndRegrade(params: {
  supabase: SupabaseServerClient
  weekId: string
  parsedAnswers: ParsedAnswer[]
  matchTagId?: MatchTagId
  deleteMissingQuestions?: boolean
  regradeExistingAnswers?: boolean
}): Promise<ReadingImportOutcome> {
  const {
    supabase,
    weekId,
    parsedAnswers,
    matchTagId = () => null,
    deleteMissingQuestions = true,
    regradeExistingAnswers = true,
  } = params
  const persistErrors: string[] = []

  const { data: existingQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  const existingMap = new Map(
    (existingQuestions ?? []).map((question) => [`${question.question_number}|${question.sub_label ?? ''}`, question]),
  )
  const parsedKeys = new Set(parsedAnswers.map((answer) => `${answer.question_number}|${answer.sub_label ?? ''}`))

  const VALID_STYLES = ['objective', 'subjective', 'ox', 'multi_select', 'find_error'] as const
  type QuestionStyle = typeof VALID_STYLES[number]

  const questionResults = await Promise.all(
    parsedAnswers.map(async (answer) => {
      const style: QuestionStyle = VALID_STYLES.includes(answer.question_style as QuestionStyle)
        ? answer.question_style as QuestionStyle
        : 'objective'
      const key = `${answer.question_number}|${answer.sub_label ?? ''}`
      const existing = existingMap.get(key)

      if (existing) {
        const { data, error } = await supabase
          .from('exam_question')
          .update({
            question_style: style,
            correct_answer: answer.correct_answer,
            correct_answer_text: answer.correct_answer_text,
            grading_criteria: answer.grading_criteria,
            explanation: answer.explanation ?? null,
            question_text: answer.question_text ?? null,
            question_stem: answer.question_stem ?? null,
            passage: answer.passage ?? null,
            choices: answer.choices ?? null,
            needs_source_image: answer.needs_source_image === true,
            source_image_reason: answer.source_image_reason ?? null,
            source_page: answer.source_page ?? null,
            source_bbox: answer.source_bbox ?? null,
            source_image_path: null,
          })
          .eq('id', existing.id)
          .select('id, question_number, sub_label, question_style, correct_answer, correct_answer_text, grading_criteria')
          .single()
        if (error) {
          console.error(
            `[week-reading-import] UPDATE failed Q${answer.question_number}${answer.sub_label ?? ''}:`,
            error,
          )
          persistErrors.push(`Q${answer.question_number}${answer.sub_label ?? ''}: ${error.message}`)
        }
        return data
      }

      const { data, error } = await supabase
        .from('exam_question')
        .insert({
          week_id: weekId,
          exam_type: 'reading',
          question_number: answer.question_number,
          sub_label: answer.sub_label ?? null,
          question_style: style,
          correct_answer: answer.correct_answer,
          correct_answer_text: answer.correct_answer_text,
          grading_criteria: answer.grading_criteria,
          explanation: answer.explanation ?? null,
          question_text: answer.question_text ?? null,
          question_stem: answer.question_stem ?? null,
          passage: answer.passage ?? null,
          choices: answer.choices ?? null,
          needs_source_image: answer.needs_source_image === true,
          source_image_reason: answer.source_image_reason ?? null,
          source_page: answer.source_page ?? null,
          source_bbox: answer.source_bbox ?? null,
          source_image_path: null,
        })
        .select('id, question_number, sub_label, question_style, correct_answer, correct_answer_text, grading_criteria')
        .single()

      if (error) {
        console.error(
          `[week-reading-import] INSERT failed Q${answer.question_number}${answer.sub_label ?? ''}:`,
          error,
        )
        persistErrors.push(`Q${answer.question_number}${answer.sub_label ?? ''}: ${error.message}`)
      }
      return data
    }),
  )

  const questions = questionResults.filter((item): item is QuestionRow => item !== null)
  if (persistErrors.length > 0) {
    throw new Error(`문항 저장 중 오류가 발생했습니다. ${persistErrors[0]}`)
  }
  if (parsedAnswers.length > 0 && questions.length === 0) {
    throw new Error('문항은 파싱됐지만 DB에 저장하지 못했습니다.')
  }

  if (deleteMissingQuestions) {
    const removedQuestions = (existingQuestions ?? []).filter(
      (question) => !parsedKeys.has(`${question.question_number}|${question.sub_label ?? ''}`),
    )
    if (removedQuestions.length > 0) {
      const removedIds = removedQuestions.map((question) => question.id)
      await supabase.from('student_answer').delete().in('exam_question_id', removedIds)
      await supabase.from('exam_question_tag').delete().in('exam_question_id', removedIds)
      await supabase.from('exam_question').delete().in('id', removedIds)
    }
  }

  const tagInserts: { exam_question_id: string; concept_tag_id: string }[] = []
  for (const question of questions) {
    const parsed = parsedAnswers.find(
      (answer) =>
        answer.question_number === question.question_number &&
        (answer.sub_label ?? null) === question.sub_label,
    )
    const tagId = matchTagId(parsed?.question_type ?? null)
    if (tagId) {
      tagInserts.push({ exam_question_id: question.id, concept_tag_id: tagId })
    }
  }

  if (questions.length > 0) {
    await supabase.from('exam_question_tag').delete().in('exam_question_id', questions.map((question) => question.id))
  }
  if (tagInserts.length > 0) {
    await supabase.from('exam_question_tag').insert(tagInserts)
  }

  const { count: qCount } = await supabase
    .from('exam_question')
    .select('id', { count: 'exact', head: true })
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
  await supabase.from('week').update({ reading_total: qCount ?? parsedAnswers.length }).eq('id', weekId)

  if (!regradeExistingAnswers) {
    return { questions_parsed: questions.length, students_regraded: 0 }
  }

  const { data: weekScores } = await supabase
    .from('week_score')
    .select('id, student_id, student_answer(id, exam_question_id, student_answer, student_answer_text, ox_selection, is_correct)')
    .eq('week_id', weekId)

  if (!weekScores?.length) {
    return { questions_parsed: questions.length, students_regraded: 0 }
  }

  const studentIds = weekScores.map((score) => score.student_id)
  const { data: students } = await supabase
    .from('student')
    .select('id, name')
    .in('id', studentIds)
  const studentNameMap = new Map((students ?? []).map((student) => [student.id, student.name]))

  const questionByKey = new Map(
    questions.map((question) => [`${question.question_number}__${question.sub_label ?? ''}`, question]),
  )
  const questionById = new Map(questions.map((question) => [question.id, question]))

  const subjectiveForGrading: SubjectiveStudentAnswer[] = []

  await Promise.all(
    weekScores.map(async (score) => {
      type AnswerRow = {
        id: string
        exam_question_id: string
        student_answer: number | null
        student_answer_text: string | null
        ox_selection: string | null
        is_correct: boolean
      }
      const answers: AnswerRow[] = (score.student_answer as unknown as AnswerRow[]) ?? []

      await Promise.all(
        answers.map(async (answer) => {
          const question = questionById.get(answer.exam_question_id)
          if (!question) return

          if (question.question_style === 'objective') {
            const isCorrect = answer.student_answer !== null && answer.student_answer === question.correct_answer
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
            return
          }

          if (question.question_style === 'ox' && answer.ox_selection) {
            const isCorrect = question.correct_answer_text
              ? gradeOX(question.correct_answer_text, answer.ox_selection, answer.student_answer_text ?? '')
              : false
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
            return
          }

          if (question.question_style === 'multi_select' && answer.student_answer_text?.trim()) {
            const isCorrect = question.correct_answer_text
              ? gradeMultiSelect(question.correct_answer_text, answer.student_answer_text)
              : false
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
            return
          }

          if (question.question_style === 'find_error' && answer.student_answer_text?.trim()) {
            await supabase.from('student_answer').update({
              is_correct: false,
              needs_review: true,
              ai_feedback: '채점 페이지에서 다시 검토해 주세요.',
            }).eq('id', answer.id)
            return
          }

          if (question.question_style === 'subjective' && answer.student_answer_text?.trim()) {
            subjectiveForGrading.push({
              week_score_id: score.id,
              exam_question_id: answer.exam_question_id,
              question_number: question.question_number,
              sub_label: question.sub_label ?? null,
              student_name: studentNameMap.get(score.student_id) ?? score.student_id,
              student_answer_text: answer.student_answer_text.trim(),
            })
          }
        }),
      )
    }),
  )

  if (subjectiveForGrading.length > 0) {
    const uniqueKeys = [...new Set(subjectiveForGrading.map((answer) => `${answer.question_number}__${answer.sub_label ?? ''}`))]
    const subjectiveQuestions = uniqueKeys
      .map((key) => {
        const question = questionByKey.get(key)
        return question?.question_style === 'subjective' && question.correct_answer_text
          ? {
              question_number: question.question_number,
              sub_label: question.sub_label ?? null,
              correct_answer_text: question.correct_answer_text,
              grading_criteria: question.grading_criteria,
            }
          : null
      })
      .filter((question): question is NonNullable<typeof question> => question !== null)

    if (subjectiveQuestions.length > 0) {
      try {
        const gradingResults = await gradeSubjectiveAnswers(subjectiveQuestions, subjectiveForGrading)
        for (const result of gradingResults) {
          await supabase
            .from('student_answer')
            .update({ is_correct: result.is_correct, ai_feedback: result.ai_feedback })
            .eq('week_score_id', result.week_score_id)
            .eq('exam_question_id', result.exam_question_id)
        }
      } catch (error) {
        console.error('[week-reading-import] subjective grading failed:', error)
        await recalcReadingCorrect(supabase, weekScores.map((score) => score.id))
        return {
          questions_parsed: questions.length,
          students_regraded: weekScores.length,
          subjective_grading_failed: true,
        }
      }
    }
  }

  await recalcReadingCorrect(supabase, weekScores.map((score) => score.id))

  return {
    questions_parsed: questions.length,
    students_regraded: weekScores.length,
  }
}

export async function applyWeekReadingAnswerKeyAndRegrade(params: {
  supabase: SupabaseServerClient
  weekId: string
  parsedAnswers: ParsedAnswer[]
}): Promise<ReadingImportOutcome> {
  const { supabase, weekId, parsedAnswers } = params

  const { data: existingQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label, question_style, correct_answer, correct_answer_text, grading_criteria')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  const existingMap = new Map(
    (existingQuestions ?? []).map((question) => [`${question.question_number}|${question.sub_label ?? ''}`, question]),
  )

  const updatedRows: QuestionRow[] = []
  for (const answer of parsedAnswers) {
    const existing = existingMap.get(`${answer.question_number}|${answer.sub_label ?? ''}`)
    if (!existing) continue

    const { data, error } = await supabase
      .from('exam_question')
      .update({
        correct_answer: answer.correct_answer,
        correct_answer_text: answer.correct_answer_text,
      })
      .eq('id', existing.id)
      .select('id, question_number, sub_label, question_style, correct_answer, correct_answer_text, grading_criteria')
      .single()

    if (error) {
      throw new Error(`Q${answer.question_number}${answer.sub_label ?? ''}: ${error.message}`)
    }
    if (data) updatedRows.push(data)
  }

  if (updatedRows.length === 0) {
    throw new Error('기존 문항과 매칭되는 정답이 없습니다.')
  }

  const { data: weekScores } = await supabase
    .from('week_score')
    .select('id, student_id, student_answer(id, exam_question_id, student_answer, student_answer_text, ox_selection, is_correct)')
    .eq('week_id', weekId)

  if (!weekScores?.length) {
    return { questions_parsed: updatedRows.length, students_regraded: 0 }
  }

  const studentIds = weekScores.map((score) => score.student_id)
  const { data: students } = await supabase
    .from('student')
    .select('id, name')
    .in('id', studentIds)
  const studentNameMap = new Map((students ?? []).map((student) => [student.id, student.name]))

  const questionByKey = new Map(
    updatedRows.map((question) => [`${question.question_number}__${question.sub_label ?? ''}`, question]),
  )
  const questionById = new Map(updatedRows.map((question) => [question.id, question]))

  const subjectiveForGrading: SubjectiveStudentAnswer[] = []

  await Promise.all(
    weekScores.map(async (score) => {
      type AnswerRow = {
        id: string
        exam_question_id: string
        student_answer: number | null
        student_answer_text: string | null
        ox_selection: string | null
        is_correct: boolean
      }
      const answers: AnswerRow[] = (score.student_answer as unknown as AnswerRow[]) ?? []

      await Promise.all(
        answers.map(async (answer) => {
          const question = questionById.get(answer.exam_question_id)
          if (!question) return

          if (question.question_style === 'objective') {
            const isCorrect = answer.student_answer !== null && answer.student_answer === question.correct_answer
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
            return
          }

          if (question.question_style === 'ox' && answer.ox_selection) {
            const isCorrect = question.correct_answer_text
              ? gradeOX(question.correct_answer_text, answer.ox_selection, answer.student_answer_text ?? '')
              : false
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
            return
          }

          if (question.question_style === 'multi_select' && answer.student_answer_text?.trim()) {
            const isCorrect = question.correct_answer_text
              ? gradeMultiSelect(question.correct_answer_text, answer.student_answer_text)
              : false
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
            return
          }

          if (question.question_style === 'find_error' && answer.student_answer_text?.trim()) {
            await supabase.from('student_answer').update({
              is_correct: false,
              needs_review: true,
              ai_feedback: '채점 페이지에서 다시 검토해 주세요.',
            }).eq('id', answer.id)
            return
          }

          if (question.question_style === 'subjective' && answer.student_answer_text?.trim()) {
            subjectiveForGrading.push({
              week_score_id: score.id,
              exam_question_id: answer.exam_question_id,
              question_number: question.question_number,
              sub_label: question.sub_label ?? null,
              student_name: studentNameMap.get(score.student_id) ?? score.student_id,
              student_answer_text: answer.student_answer_text.trim(),
            })
          }
        }),
      )
    }),
  )

  if (subjectiveForGrading.length > 0) {
    const uniqueKeys = [...new Set(subjectiveForGrading.map((answer) => `${answer.question_number}__${answer.sub_label ?? ''}`))]
    const subjectiveQuestions = uniqueKeys
      .map((key) => {
        const question = questionByKey.get(key)
        return question?.question_style === 'subjective' && question.correct_answer_text
          ? {
              question_number: question.question_number,
              sub_label: question.sub_label ?? null,
              correct_answer_text: question.correct_answer_text,
              grading_criteria: question.grading_criteria,
            }
          : null
      })
      .filter((question): question is NonNullable<typeof question> => question !== null)

    if (subjectiveQuestions.length > 0) {
      try {
        const gradingResults = await gradeSubjectiveAnswers(subjectiveQuestions, subjectiveForGrading)
        for (const result of gradingResults) {
          await supabase
            .from('student_answer')
            .update({ is_correct: result.is_correct, ai_feedback: result.ai_feedback })
            .eq('week_score_id', result.week_score_id)
            .eq('exam_question_id', result.exam_question_id)
        }
      } catch (error) {
        console.error('[week-reading-import] subjective grading failed:', error)
        await recalcReadingCorrect(supabase, weekScores.map((score) => score.id))
        return {
          questions_parsed: updatedRows.length,
          students_regraded: weekScores.length,
          subjective_grading_failed: true,
        }
      }
    }
  }

  await recalcReadingCorrect(supabase, weekScores.map((score) => score.id))
  return {
    questions_parsed: updatedRows.length,
    students_regraded: weekScores.length,
  }
}
