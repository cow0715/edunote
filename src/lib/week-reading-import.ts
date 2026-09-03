import type { SupabaseServerClient } from '@/lib/api'
import { buildQuestionTextFromParts, ensureChoiceMarker } from '@/lib/question-structure'
import {
  gradeSubjectiveAnswers,
  parseAnswerSheet,
  parseAnswerSheetRanged,
} from '@/lib/anthropic'
import type {
  ParsedAnswer,
  SourceBBox,
  SubjectiveStudentAnswer,
  TagCategory,
  WeekProblemSheetQuestion,
} from '@/lib/anthropic'
import { recalcReadingCorrect, gradeMultiSelect } from '@/lib/grade-utils'
import { gradeOX } from '@/lib/ox-grading'
import { gradeFindErrorRow, normalizeFindErrorKeyText } from '@/lib/find-error-grading'

import { getPdfPageCount } from '@/lib/pdf'
import { runParsePipeline, type PipelineFile, type SkippedRange } from '@/lib/llm/pipeline'
import { isContentFilterError } from '@/lib/llm/client'
import { coerceQuestionNumber } from '@/lib/llm/postprocess'

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
  /** 재파싱 결과에서 사라져 지운 문항 수 */
  questions_deleted?: number
  /** 그와 함께 지워진 학생 답안 수 */
  answers_deleted?: number
}

export type ProblemSheetUploadInput = {
  fileData?: string
  storagePath?: string
  mimeType: string
  fileName?: string
  pageOffset?: number
}

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

/**
 * 위 안전망의 구조화 필드(question_stem/passage)판.
 * 해설지형도 이제 조각 필드를 채우고, 화면은 조각이 있으면 그쪽을 우선해서 그린다.
 * question_text 에만 밑줄을 붙이면 화면에서는 밑줄이 사라진다 — 같은 규칙을 조각에도 적용한다.
 */
export function applyUnderlineMarkupToParts<T extends {
  question_text?: string | null
  question_stem?: string | null
  passage?: string | null
  choices?: string[] | null
}>(answer: T): T {
  if (!answer.question_stem?.trim() && !answer.passage?.trim()) return answer

  const asksUnderlinedWord = /밑줄\s*친|낱말의\s*쓰임|문맥상\s*낱말/.test(
    answer.question_stem ?? answer.question_text ?? ''
  )
  if (!asksUnderlinedWord) return answer

  const choices = (answer.choices ?? []).filter((choice) => choice.trim())
  if (choices.length < 2) return answer

  const mark = (text: string) => text.split('\n')
    .map((line) => (isCircledChoiceLine(line) ? line : underlinePassageChoices(line, choices)))
    .join('\n')

  return {
    ...answer,
    question_stem: answer.question_stem ? mark(answer.question_stem) : answer.question_stem,
    passage: answer.passage ? mark(answer.passage) : answer.passage,
  }
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

/** 문항 번호별 find_error 정답키 묶음 — 소문항 집합 매칭 재채점용 */
function buildFindErrorKeyMap(
  questions: { question_number: number; question_style: string; correct_answer_text: string | null }[],
): Map<number, (string | null)[]> {
  const map = new Map<number, (string | null)[]>()
  for (const q of questions) {
    if (q.question_style !== 'find_error') continue
    const arr = map.get(q.question_number) ?? []
    arr.push(q.correct_answer_text)
    map.set(q.question_number, arr)
  }
  return map
}

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

      // find_error 정답키는 "기호:수정어" 규격으로 정규화 (기호 표기·화살표 이탈 흡수)
      const correctAnswerText = answer.question_style === 'find_error'
        ? normalizeFindErrorKeyText(answer.correct_answer_text) ?? answer.correct_answer_text
        : answer.correct_answer_text

      return {
        ...answer,
        question_number: questionNumber,
        correct_answer: coerceCorrectAnswer(answer.correct_answer),
        correct_answer_text: correctAnswerText,
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

/** 여러 행을 한 행으로 합칠 때, 비어 있는 칸을 형제 행에서 채운다 */
function mergeSplitRows(group: ParsedAnswer[]): ParsedAnswer {
  const len = (v: string | null | undefined) => (v ?? '').length
  // 지문이 가장 긴 행을 뼈대로 — 조합 선택형은 한쪽에만 지문이 실리는 경우가 많다
  const base = [...group].sort((a, b) => len(b.question_text) - len(a.question_text))[0]
  const firstOf = <K extends keyof ParsedAnswer>(key: K): ParsedAnswer[K] =>
    (group.find((row) => {
      const v = row[key]
      return typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined
    })?.[key] ?? base[key])

  return {
    ...base,
    sub_label: null,
    question_type: firstOf('question_type'),
    explanation: firstOf('explanation'),
    question_stem: firstOf('question_stem'),
    // 선지도 형제 행에서 채운다 — base 는 "지문이 가장 긴 행" 이라 선지가 다른 행에 실려 있으면
    // ...base 만으로는 통째로 유실된다 (조합 선택형에서 지문·선지가 갈려 오는 경우)
    choices: firstOf('choices'),
    passage: firstOf('passage'),
  }
}

function collapseSplitObjectiveQuestion(group: ParsedAnswer[]): ParsedAnswer | null {
  if (group.length < 2) return null

  // ── 조합 선택형(요약문 (A)(B), 보기 묶음형)을 소문항으로 쪼갠 경우 ──────────
  //
  // 판정: 전부 objective 인데 정답 번호가 한 종류뿐.
  // 학생은 ①~⑤ 중 하나만 고르므로 **독립된 소문항 둘이 같은 번호를 정답으로 가질 수 없다.**
  // 논리적으로 불가능한 상태라 휴리스틱이 아니라 확정이다.
  // (진짜 어법 'n개 고르' 는 정답이 ②④ 처럼 서로 다르므로 여기 안 걸린다)
  //
  // 아래 기존 분기처럼 텍스트 모양(looksLikeSummaryBlankObjective)을 보지 않는다.
  // 모양을 가정한 방어는 실제 LLM 출력과 어긋나면 그대로 무력화된다 —
  // 아래 분기가 'objective 1개 + subjective 몇 개' 만 상정하는 바람에
  // 실제로 나온 'objective 2개' 형태를 몇 달간 놓쳤다.
  const allObjective = group.every(
    (answer) => answer.question_style === 'objective' && answer.correct_answer >= 1 && answer.correct_answer <= 5,
  )
  if (allObjective) {
    const distinct = new Set(group.map((answer) => answer.correct_answer))
    return distinct.size === 1 ? mergeSplitRows(group) : null
  }

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

/**
 * 해설지형 통짜 파싱 (문항+정답+해설을 한 콜에).
 * 범위 분할(기본 경로)이 실패한 문서의 폴백 경로.
 */
async function parseAnswerSheetWhole(
  files: ProblemSheetUploadInput[],
  tagCategories: TagCategory[] = [],
): Promise<{ answers: ParsedAnswer[]; skipped: SkippedRange[] }> {
  const { items, skipped } = await runParsePipeline<ParsedAnswer, ParsedAnswer>({
    label: 'week-answer-sheet',
    chunk: { kind: 'whole' },
    // whole 1청크라 재시도 단위가 없음 — 필터로 통째 막히면 skip 되어 빈 결과 → 라우트가 422 처리
    onChunkError: { skipIf: isContentFilterError },
    parseChunk: (file) => parseAnswerSheet(file.fileData, file.mimeType, tagCategories),
    normalizeChunk: (parsed, file) => normalizeSourceFieldsForChunk(parsed, file)
      .map((answer) => ({
        ...answer,
        needs_source_image: shouldStoreSourceImage(answer),
        source_image_reason: answer.source_image_reason ?? null,
      })),
    // 소문항 라벨·요약문 오분할 복구는 해설지형 고유 규칙(normalizeParsedAnswers)에 있음
    postProcess: [normalizeParsedAnswers],
    finalize: (answers) => answers.map((answer) => applyUnderlineMarkupToParts(answer.question_text
      ? { ...answer, question_text: applyUnderlineMarkupToQuestionText(answer.question_text) }
      : answer)),
  }, toPipelineFiles(files))
  return { answers: items, skipped }
}

/**
 * 해설지통합형 출력 범위 분할: 번호 발견 콜(캐시 예열 겸) → 번호 그룹 병렬 파싱 → 병합.
 * 문서를 자르지 않으므로 경계 탐지·백지 슬라이스 폴백이 불필요하고, 매 콜 문서 전체를 보므로
 * 문항부-해설부 짝맞추기가 자동이다. whole 경로와 동일한 정규화 체인을 병합 결과에 적용한다.
 * (단일 파일 전용)
 */
export async function parseAnswerSheetDocumentRanged(
  files: ProblemSheetUploadInput[],
  tagCategories: TagCategory[] = [],
): Promise<{ answers: ParsedAnswer[]; discoveredNumbers: number[]; skippedNumbers: number[] }> {
  if (!files.length || files.some((file) => !file.fileData)) {
    throw new Error('업로드 파일 데이터를 읽지 못했습니다.')
  }
  // 파일 1~N개 (통합형 1개 / 시험지+해설지 세트 / 낱장 사진 묶음) — 순서대로 전부 첨부
  const result = await parseAnswerSheetRanged(
    files.map((file) => ({ fileData: file.fileData!, mimeType: file.mimeType })), tagCategories)

  const [pipelineFile] = toPipelineFiles(files)
  let answers: ParsedAnswer[] = normalizeSourceFieldsForChunk(result.items, pipelineFile)
    .map((answer) => ({
      ...answer,
      needs_source_image: shouldStoreSourceImage(answer),
      source_image_reason: answer.source_image_reason ?? null,
    }))
  answers = normalizeParsedAnswers(answers)
    .map((answer) => applyUnderlineMarkupToParts(answer.question_text
      ? { ...answer, question_text: applyUnderlineMarkupToQuestionText(answer.question_text) }
      : answer))
  return { answers, discoveredNumbers: result.discoveredNumbers, skippedNumbers: result.skippedNumbers }
}

/**
 * 해설지형 진입점 — 2단 폴백:
 * ① 출력 범위 분할 (번호 발견 → 그룹 병렬, 문서 안 자름 — 기본 경로, 실측: 숭문 7p 84s)
 *    파일 1~N개 지원: 통합형 1개 / 시험지+해설지 세트 / 낱장 사진 묶음
 * ② 통짜 1콜 (①이 실패한 문서)
 */
export async function parseAnswerSheetDocument(
  files: ProblemSheetUploadInput[],
  tagCategories: TagCategory[] = [],
): Promise<{ answers: ParsedAnswer[]; skipped: SkippedRange[]; skippedQuestionNumbers?: number[] }> {
  if (files.length && files.every((file) => file.fileData)) {
    try {
      const ranged = await parseAnswerSheetDocumentRanged(files, tagCategories)
      if (ranged.answers.length) {
        return { answers: ranged.answers, skipped: [], skippedQuestionNumbers: ranged.skippedNumbers }
      }
      console.warn('[week-answer-sheet] 범위 분할 결과 0건 — 통짜 폴백')
    } catch (error) {
      console.warn('[week-answer-sheet] 범위 분할 실패 — 통짜 폴백:',
        error instanceof Error ? error.message : error)
    }
  }
  return parseAnswerSheetWhole(files, tagCategories)
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
  let deletedCount = 0
  let deletedAnswerCount = 0

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

      // 사라진 문항의 학생 답안도 함께 지운다.
      //
      // 예전에는 이걸 조용히 했고, 그래서 재파싱 한 번에 채점 결과가 말없이 날아갔다.
      // 지금은 라우트가 먼저 막는다 — 답안이 있는 주차를 재파싱하려면 discardAnswers 로
      // 명시적으로 동의해야 여기까지 온다.
      //
      // 답안을 남기는(is_void) 쪽도 해봤는데 더 나빴다. 무효 행에 답안이 매달린 채
      // 새 문항은 빈 상태가 되어, 강사가 눈치채지 못하면 점수가 조용히 내려갔다.
      // 조용히 틀린 점수보다 명백히 빈 상태가 낫다.
      const { count } = await supabase
        .from('student_answer')
        .select('id', { count: 'exact', head: true })
        .in('exam_question_id', removedIds)

      await supabase.from('student_answer').delete().in('exam_question_id', removedIds)
      await supabase.from('exam_question_tag').delete().in('exam_question_id', removedIds)
      await supabase.from('exam_question').delete().in('id', removedIds)

      deletedCount = removedIds.length
      deletedAnswerCount = count ?? 0
      if (deletedAnswerCount > 0) {
        console.warn(`[week-reading-import] 사라진 ${deletedCount}문항과 학생 답안 ${deletedAnswerCount}개 삭제`)
      }
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
    return { questions_parsed: questions.length, students_regraded: 0, questions_deleted: deletedCount, answers_deleted: deletedAnswerCount }
  }

  const { data: weekScores } = await supabase
    .from('week_score')
    .select('id, student_id, student_answer(id, exam_question_id, student_answer, student_answer_text, ox_selection, is_correct)')
    .eq('week_id', weekId)

  if (!weekScores?.length) {
    return { questions_parsed: questions.length, students_regraded: 0, questions_deleted: deletedCount, answers_deleted: deletedAnswerCount }
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
  const findErrorKeysByNumber = buildFindErrorKeyMap([...questionById.values()])

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
            // 기호+표현이 정답과 일치하거나 기호가 아예 다르면 코드로 확정, 애매한 것만 검토 표시
            const keys = findErrorKeysByNumber.get(question.question_number) ?? [question.correct_answer_text]
            const verdict = gradeFindErrorRow(keys, answer.student_answer_text)
            if (verdict === 'ai') {
              await supabase.from('student_answer').update({
                is_correct: false,
                needs_review: true,
                ai_feedback: '채점 페이지에서 다시 검토해 주세요.',
              }).eq('id', answer.id)
            } else if ((verdict === 'correct') !== answer.is_correct) {
              await supabase.from('student_answer').update({
                is_correct: verdict === 'correct',
                needs_review: false,
                ai_feedback: null,
              }).eq('id', answer.id)
            }
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
          questions_deleted: deletedCount,
          answers_deleted: deletedAnswerCount,
        }
      }
    }
  }

  await recalcReadingCorrect(supabase, weekScores.map((score) => score.id))

  return {
    questions_parsed: questions.length,
    students_regraded: weekScores.length,
    questions_deleted: deletedCount,
    answers_deleted: deletedAnswerCount,
  }
}

/** 정오표 정답만 기존 문항에 반영 (재채점 없음). 매칭 실패 문항은 건너뛰고 0건이면 throw */
export async function applyAnswerKeyWithoutRegrade(
  supabase: SupabaseServerClient,
  weekId: string,
  parsedAnswers: ParsedAnswer[],
): Promise<ReadingImportOutcome> {
  const { data: existingQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  const existingMap = new Map(
    (existingQuestions ?? []).map((question) => [`${question.question_number}|${question.sub_label ?? ''}`, question.id]),
  )

  let updatedCount = 0
  for (const answer of parsedAnswers) {
    const id = existingMap.get(`${answer.question_number}|${answer.sub_label ?? ''}`)
    if (!id) continue

    const { error } = await supabase
      .from('exam_question')
      .update({
        question_style: answer.question_style,
        correct_answer: answer.correct_answer,
        correct_answer_text: answer.correct_answer_text,
      })
      .eq('id', id)

    if (error) throw new Error(`Q${answer.question_number}${answer.sub_label ?? ''}: ${error.message}`)
    updatedCount += 1
  }

  if (updatedCount === 0) {
    throw new Error('기존 문항과 매칭되는 정답이 없습니다.')
  }

  const { count } = await supabase
    .from('exam_question')
    .select('id', { count: 'exact', head: true })
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
  await supabase.from('week').update({ reading_total: count ?? updatedCount }).eq('id', weekId)

  return { questions_parsed: updatedCount, students_regraded: 0 }
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
  const findErrorKeysByNumber = buildFindErrorKeyMap([...questionById.values()])

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
            // 기호+표현이 정답과 일치하거나 기호가 아예 다르면 코드로 확정, 애매한 것만 검토 표시
            const keys = findErrorKeysByNumber.get(question.question_number) ?? [question.correct_answer_text]
            const verdict = gradeFindErrorRow(keys, answer.student_answer_text)
            if (verdict === 'ai') {
              await supabase.from('student_answer').update({
                is_correct: false,
                needs_review: true,
                ai_feedback: '채점 페이지에서 다시 검토해 주세요.',
              }).eq('id', answer.id)
            } else if ((verdict === 'correct') !== answer.is_correct) {
              await supabase.from('student_answer').update({
                is_correct: verdict === 'correct',
                needs_review: false,
                ai_feedback: null,
              }).eq('id', answer.id)
            }
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
