import type { SupabaseServerClient } from '@/lib/api'
import { buildQuestionTextFromParts, ensureChoiceMarker } from '@/lib/question-structure'
import {
  gradeSubjectiveAnswers,
  parseAnswerSheet,
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

import { getPdfPageCount, getPdfPageTexts, pageStartsWithQuestion, planAlignedPageChunks, splitPdfByRangesBase64 } from '@/lib/pdf'
import { runParsePipeline, type PipelineFile } from '@/lib/llm/pipeline'
import { coerceQuestionNumber, renumberDuplicateQuestions, propagateSharedPassage } from '@/lib/llm/postprocess'

export type MatchTagId = (questionType: string | null, questionStyle?: string | null) => string | null

export type TagListEntry = { id: string; name: string; categoryName: string | null }

export type TeacherTagContext = {
  tagList: TagListEntry[]
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

/** 문제지형 청크 정책: 3페이지씩, 문항 경계에 맞춰 자름 (지문이 페이지를 넘어가면 최대 5페이지까지 늘림) */
const PROBLEM_SHEET_CHUNK_POLICY = { kind: 'pages', pagesPerChunk: 3, alignToQuestionStart: true, maxPagesPerChunk: 5 } as const
/** 청크 동시 처리 수 — Anthropic rate limit 예산과 맞바꾸는 값.
 * 실측(44p 내신 PDF, 청크 11): 동시 2 = 641.8s, 동시 6 = 260.6s (2.5배). 계정 한도는
 * sonnet ITPM 10M/분(Scale 티어)이라 이 규모에선 병목이 아니다. 단, 이 값만큼 요청이
 * 길어지는 게 아니라 "한 함수 안에서" 도는 legacy 경로 총시간을 줄일 뿐이고,
 * 큰 문서는 청크 분리 경로(import-plan/chunk/finalize)를 탄다. */
const PDF_PARSE_CONCURRENCY = 4

/** 파일 데이터 없는 입력(storagePath 만 있는 것)은 파이프라인에 넣기 전에 resolve 돼 있어야 한다 */
function toPipelineFiles(files: ProblemSheetUploadInput[]): PipelineFile[] {
  return files.map((file) => {
    if (!file.fileData) throw new Error('업로드 파일 데이터를 읽지 못했습니다.')
    return { fileData: file.fileData, mimeType: file.mimeType, fileName: file.fileName, pageOffset: file.pageOffset }
  })
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

function isCircledChoiceLine(line: string): boolean {
  return /^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.)])\s*\S/.test(line)
}

/**
 * 해설지형(question_text 단일 컬럼)용 밑줄 자동 부착 안전망.
 * "밑줄 친 낱말" 유형이고 하단에 선지 목록(①… 줄)이 있으면, 지문 속 `① word` 에 <u> 를 붙인다.
 * 선지 목록 줄 자체에는 붙이지 않는다. 밑줄 구간 정보가 없는 유형(지문 내 ① 마커만 있고
 * 선지 목록이 없는 어법형)은 복원 불가라 그대로 둔다. 멱등 (이미 <u> 면 다시 안 감쌈).
 * 문제지형은 파싱 단계에서 normalizeQuestionVisualMarkup 이 같은 일을 한다.
 */
export function applyUnderlineMarkupToQuestionText(questionText: string): string {
  const asksUnderlinedWord = /밑줄\s*친|낱말의\s*쓰임|문맥상\s*낱말/.test(questionText)
  if (!asksUnderlinedWord) return questionText

  const lines = questionText.split('\n')
  const choices = lines.filter((line) => isCircledChoiceLine(line)).map((line) => line.trim())
  if (choices.length < 2) return questionText

  return lines
    .map((line) => (isCircledChoiceLine(line) ? line : underlinePassageChoices(line, choices)))
    .join('\n')
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

  const tagList: TagListEntry[] = []
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

  const categoryNameById = new Map((categories ?? []).map((category) => [category.id, category.name]))

  for (const tag of tags ?? []) {
    tagList.push({
      id: tag.id,
      name: tag.name,
      categoryName: tag.concept_category_id ? categoryNameById.get(tag.concept_category_id) ?? null : null,
    })
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

/** 텍스트 답안을 받는 형식 — 서술형 카테고리 태그가 붙어야 하는 문항 */
const SUBJECTIVE_QUESTION_STYLES = new Set(['subjective', 'find_error'])

/**
 * 서술형 카테고리 판별. 카테고리에 플래그 컬럼이 없어 이름으로 본다.
 * (시드 기본값이 '서술형 유형'. 강사가 카테고리명에서 '서술형'을 빼면 판별이 깨진다.)
 */
function isSubjectiveCategory(categoryName: string | null): boolean {
  return !!categoryName && categoryName.includes('서술형')
}

/**
 * AI가 반환하는 question_type은 태그 '이름'뿐이라 카테고리를 알 수 없다.
 * 그런데 '어법'·'어휘'·'빈칸'은 독해 유형과 서술형 유형 양쪽에 같은 이름으로 존재한다.
 * 이름만으로 첫 번째를 집으면 sort_order가 낮은 서술형 쪽이 항상 이겨서,
 * 객관식 수능 문항이 서술형으로 분류돼 왔다. 문항 형식으로 갈라준다.
 */
export function createTagMatcher(tagList: TagListEntry[]): MatchTagId {
  const normalize = (value: string) => value.replace(/\s/g, '').toLowerCase()

  return (questionType: string | null, questionStyle: string | null = null) => {
    if (!questionType) return null

    const exact = tagList.filter((tag) => tag.name === questionType)
    const normalizedQuestionType = normalize(questionType)
    const candidates = exact.length > 0
      ? exact
      : tagList.filter((tag) => normalize(tag.name) === normalizedQuestionType)

    if (candidates.length === 0) return null
    if (candidates.length === 1) return candidates[0].id

    // 이름이 겹치면 문항 형식으로 고른다. 한쪽밖에 없으면(예: '요약문'은 서술형에만
    // 존재) 억지로 버리지 않고 그대로 쓴다 — 태그를 잃는 것보다 낫다.
    const wantSubjective = SUBJECTIVE_QUESTION_STYLES.has(questionStyle ?? '')
    const preferred = candidates.filter(
      (tag) => isSubjectiveCategory(tag.categoryName) === wantSubjective,
    )
    return (preferred[0] ?? candidates[0]).id
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

/**
 * 청크 단위 보정: 번호 coerce, 스타일 정규화, source_page 를 원본 문서 기준으로 (pageOffset 반영), bbox 검증.
 * 해설지형·문제지형 공용 — 청크가 1개(whole)면 pageOffset 0 이라 그대로 통과한다.
 */
function normalizeSourceFieldsForChunk<T extends {
  question_number: unknown
  source_page?: number | null
  source_bbox?: SourceBBox | null
}>(items: T[], file: PipelineFile): T[] {
  const result: T[] = []
  for (const item of items) {
    const questionNumber = coerceQuestionNumber(item.question_number)
    if (!questionNumber) continue
    const localSourcePage = coerceQuestionNumber(item.source_page)
    result.push({
      ...item,
      question_number: questionNumber,
      source_page: localSourcePage ? (file.pageOffset ?? 0) + localSourcePage : null,
      source_bbox: normalizeSourceBBox(item.source_bbox),
    })
  }
  return result
}

async function parseProblemSheetQuestionInputs(
  files: ProblemSheetUploadInput[],
  tagCategories: TagCategory[] = [],
): Promise<WeekProblemSheetQuestion[]> {
  const { items } = await runParsePipeline<WeekProblemSheetQuestion, WeekProblemSheetQuestion>({
    label: 'week-problem-sheet',
    chunk: PROBLEM_SHEET_CHUNK_POLICY,
    concurrency: PDF_PARSE_CONCURRENCY,
    onChunkError: 'retry-per-page',
    parseChunk: (file) => parseWeekProblemSheetPage(file.fileData, file.mimeType, tagCategories),
    normalizeChunk: (parsed, file) => normalizeSourceFieldsForChunk(parsed, file)
      .map((question) => ({ ...question, question_style: normalizeQuestionStyle(question.question_style) })),
    postProcess: [renumberDuplicateQuestions, propagateSharedPassage],
    finalize: (questions) => questions,
  }, toPipelineFiles(files))
  return items
}

/**
 * 해설지형: 문서 통째 1회 파싱 (문항+정답+해설이 한 문서에 있음).
 * 같은 엔진을 타므로 번호 재배정·bbox 보정·밑줄 안전망을 문제지형과 동일하게 받는다.
 */
export async function parseAnswerSheetDocument(
  files: ProblemSheetUploadInput[],
  tagCategories: TagCategory[] = [],
): Promise<ParsedAnswer[]> {
  const { items } = await runParsePipeline<ParsedAnswer, ParsedAnswer>({
    label: 'week-answer-sheet',
    chunk: { kind: 'whole' },
    parseChunk: (file) => parseAnswerSheet(file.fileData, file.mimeType, tagCategories),
    normalizeChunk: (parsed, file) => normalizeSourceFieldsForChunk(parsed, file)
      .map((answer) => ({
        ...answer,
        needs_source_image: shouldStoreSourceImage(answer),
        source_image_reason: answer.source_image_reason ?? null,
      })),
    // 소문항 라벨·요약문 오분할 복구는 해설지형 고유 규칙(normalizeParsedAnswers)에 있음
    postProcess: [normalizeParsedAnswers],
    finalize: (answers) => answers.map((answer) => answer.question_text
      ? { ...answer, question_text: applyUnderlineMarkupToQuestionText(answer.question_text) }
      : answer),
  }, toPipelineFiles(files))
  return items
}

function normalizeQuestionStyle(
  style: string | null | undefined,
): 'objective' | 'subjective' | 'ox' | 'multi_select' {
  if (style === 'subjective' || style === 'ox' || style === 'multi_select') return style
  return 'objective'
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

function toParsedAnswerFromProblemSheetQuestion(question: WeekProblemSheetQuestion): ParsedAnswer {
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

  return questions.map(toParsedAnswerFromProblemSheetQuestion)
}

// ── 문제지형 청크 분리 가져오기 (Vercel maxDuration 대응) ─────────────────
// 계획(경계 계산) → 청크별 파싱(요청 분리, 결과는 스테이징) → finalize(전역 후처리 + 저장)
// 를 별도 HTTP 요청으로 나누기 위한 단계별 함수. 후처리(번호 재배정·지문 전파)는
// 전 청크가 모여야 하므로 반드시 finalize 에서만 실행한다.

export type ProblemSheetChunkRange = { startPage: number; endPage: number }

/** 청크 파싱 결과 스테이징 JSON 의 저장 경로 (exam-pdf-temp 버킷 내, 원본 옆) */
export function problemSheetStagingPath(storagePath: string, chunkIndex: number) {
  return `${storagePath}.chunks/${chunkIndex}.json`
}

/** 청크 경계 계산 (LLM 0콜). 텍스트 추출 실패 시 파일 전체 1청크. */
export async function planProblemSheetChunks(fileData: string, mimeType: string): Promise<ProblemSheetChunkRange[]> {
  if (mimeType !== 'application/pdf') return [{ startPage: 0, endPage: 1 }]
  const pageTexts = await getPdfPageTexts(fileData).catch(() => null)
  if (!pageTexts) {
    const pageCount = await getPdfPageCount(fileData).catch(() => 1)
    return [{ startPage: 0, endPage: pageCount }]
  }
  if (pageTexts.length <= PROBLEM_SHEET_CHUNK_POLICY.pagesPerChunk) {
    return [{ startPage: 0, endPage: pageTexts.length }]
  }
  return planAlignedPageChunks(
    pageTexts.map(pageStartsWithQuestion),
    PROBLEM_SHEET_CHUNK_POLICY.pagesPerChunk,
    PROBLEM_SHEET_CHUNK_POLICY.maxPagesPerChunk,
  )
}

/**
 * 청크 1개 파싱: 원본에서 페이지 범위를 잘라 LLM 파싱 후 청크 단위 보정까지 적용.
 * 전역 후처리는 하지 않은 원시 문항을 돌려준다 (finalize 입력용).
 * 실패 시 파이프라인의 retry-per-page 가 페이지 단위 재시도를 해준다.
 */
export async function parseProblemSheetChunkForStaging(params: {
  fileData: string
  mimeType: string
  range: ProblemSheetChunkRange
  tagCategories?: TagCategory[]
}): Promise<WeekProblemSheetQuestion[]> {
  const { fileData, mimeType, range, tagCategories = [] } = params
  let chunkData = fileData
  let pageOffset = 0
  if (mimeType === 'application/pdf') {
    const [cut] = await splitPdfByRangesBase64(fileData, [range])
    chunkData = cut.fileData
    pageOffset = range.startPage
  }

  const { items } = await runParsePipeline<WeekProblemSheetQuestion, WeekProblemSheetQuestion>({
    label: 'week-problem-sheet-chunk',
    chunk: { kind: 'whole' },
    onChunkError: 'retry-per-page',
    parseChunk: (file) => parseWeekProblemSheetPage(file.fileData, file.mimeType, tagCategories),
    normalizeChunk: (parsed, file) => normalizeSourceFieldsForChunk(parsed, file)
      .map((question) => ({ ...question, question_style: normalizeQuestionStyle(question.question_style) })),
    finalize: (questions) => questions,
  }, [{ fileData: chunkData, mimeType, pageOffset }])
  return items
}

/** 스테이징된 청크들을 페이지 순서로 합쳐 전역 후처리 + ParsedAnswer 변환 (순수 함수) */
export function finalizeProblemSheetQuestions(chunkItems: WeekProblemSheetQuestion[][]): ParsedAnswer[] {
  const merged = propagateSharedPassage(renumberDuplicateQuestions(chunkItems.flat()))
  if (!merged.length) {
    throw new Error('시험지에서 문항 구조를 찾지 못했습니다.')
  }
  return merged.map(toParsedAnswerFromProblemSheetQuestion)
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

  // 정오표: 3페이지 청크, 순차. 같은 번호가 여러 청크에 나오면 뒤의 것이 이긴다 (최종 정답표 우선)
  const { items: keyItems } = await runParsePipeline<ProblemSheetAnswerKeyItem, ProblemSheetAnswerKeyItem>({
    label: 'week-answer-key',
    chunk: { kind: 'pages', pagesPerChunk: 3 },
    parseChunk: (file) => parseProblemSheetAnswerKeyFile(file.fileData, file.mimeType, questions),
    finalize: (items) => items,
  }, toPipelineFiles(files))

  const mergedItems = new Map<number, ProblemSheetAnswerKeyItem>()
  for (const item of keyItems) {
    const questionNumber = coerceQuestionNumber(item.question_number)
    if (!questionNumber) continue
    mergedItems.set(questionNumber, {
      ...item,
      question_number: questionNumber,
      correct_answer: coerceCorrectAnswer(item.correct_answer),
    })
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

/**
 * unpdf 가 번들한 pdfjs 는 modern 빌드라 `ArrayBuffer.prototype.transferToFixedLength`(Node 21+)를
 * 폰트 치환에서 그대로 쓴다. Node 20 에서는 이게 없어서 렌더가 조용히 실패하고 **백지 PNG** 가 나온다
 * (throw 하지 않고 "ignoring errors during GetOperatorList" 경고만 남는다 — 2026-08-25 실측).
 * 런타임 Node 가 20 일 수 있는 한 가드가 필요하다. 호출부가 항상 길이를 넘기므로 잘라 복사하면 충분하다.
 */
function ensureArrayBufferTransferPolyfill() {
  const proto = ArrayBuffer.prototype as ArrayBuffer & {
    transferToFixedLength?: (length?: number) => ArrayBuffer
  }
  if (typeof proto.transferToFixedLength === 'function') return
  proto.transferToFixedLength = function (this: ArrayBuffer, length?: number) {
    const size = length ?? this.byteLength
    const out = new ArrayBuffer(size)
    new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(size, this.byteLength)))
    return out
  }
}

/**
 * PDF 한 페이지를 PNG 으로 렌더한다.
 * pdfjs-dist 를 직접 쓰면 Node 에서 fake worker 경로로 빠지면서 `pdf.worker.mjs` 를 런타임에 파일로
 * import 하는데, (1) 그 경로가 문자열 조합이라 Vercel 파일 트레이싱이 못 보고, (2) 같은 프로세스에서
 * unpdf 가 먼저 돌면 unpdf 가 심어둔 `globalThis.pdfjsWorker`(pdfjs 5.4)를 pdfjs-dist(5.6)가 집어가
 * "API version does not match Worker version" 으로 죽는다. 이 파일은 위쪽에서 unpdf 로 텍스트를 뽑으므로
 * 정확히 그 순서다. unpdf 로 통일하면 둘 다 사라진다.
 */
export async function renderPdfPageToPng(
  fileData: string,
  pageNumber: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  ensureArrayBufferTransferPolyfill()

  const { renderPageAsImage } = await import('unpdf')
  const rendered = await renderPageAsImage(
    new Uint8Array(Buffer.from(fileData, 'base64')),
    pageNumber,
    { canvasImport: () => import('@napi-rs/canvas'), scale: 1.5 },
  )

  // 크롭 bbox 는 0~1 상대좌표라 픽셀 환산에 실제 렌더 크기가 필요하다. 페이지당 한 번만 읽어 재사용한다.
  const buffer = Buffer.from(rendered)
  const sharp = (await import('sharp')).default
  const { width, height } = await sharp(buffer).metadata()
  if (!width || !height) throw new Error('렌더된 페이지 크기를 읽지 못했습니다.')

  return { buffer, width, height }
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
      const pageCount = await getPdfPageCount(file.fileData)
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
    const tagId = matchTagId(parsed?.question_type ?? null, parsed?.question_style ?? null)
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
