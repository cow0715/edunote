import type { SupabaseServerClient } from '@/lib/api'
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
): Promise<WeekProblemSheetQuestion[]> {
  const collected: WeekProblemSheetQuestion[] = []

  for (const file of files) {
    if (!file.fileData) {
      throw new Error('업로드 파일 데이터를 읽지 못했습니다.')
    }
    const parsed = await parseWeekProblemSheetPage(file.fileData, file.mimeType)
    const normalizedPage = parsed
      .map((question) => {
        const questionNumber = coerceQuestionNumber(question.question_number)
        if (!questionNumber) return null

        return {
          ...question,
          question_number: questionNumber,
          question_style: normalizeQuestionStyle(question.question_style),
        }
      })
      .filter((question): question is WeekProblemSheetQuestion => question !== null)

    collected.push(...normalizedPage)
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
  const parts: string[] = []
  const stem = question.question_text.trim()
  const passage = question.passage.trim()

  if (stem) parts.push(stem)
  if (passage) parts.push(passage)
  if (question.choices.length > 0) {
    parts.push(question.choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n'))
  }

  return parts.length > 0 ? parts.join('\n') : null
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
): Promise<ParsedAnswer[]> {
  if (!files.length) {
    throw new Error('시험지 파일이 없습니다.')
  }

  const questions = await parseProblemSheetQuestionInputs(files)

  if (!questions.length) {
    throw new Error('시험지에서 문항 구조를 찾지 못했습니다.')
  }

  return questions.map((question) => ({
    question_number: question.question_number,
    sub_label: null,
    question_style: question.question_style,
    question_type: question.question_type,
    correct_answer: 0,
    correct_answer_text: null,
    grading_criteria: null,
    explanation: null,
    question_text: buildStoredQuestionText(question),
  }))
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
  for (const file of files) {
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

export async function syncWeekReadingQuestionsAndRegrade(params: {
  supabase: SupabaseServerClient
  weekId: string
  parsedAnswers: ParsedAnswer[]
  matchTagId?: MatchTagId
  deleteMissingQuestions?: boolean
}): Promise<ReadingImportOutcome> {
  const { supabase, weekId, parsedAnswers, matchTagId = () => null, deleteMissingQuestions = true } = params
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
