// ── 모의고사: 성적표용 메타데이터 파싱 + 답안지/OMR 인식 ──────────────────────

import type { TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { buildExamOcrVisionPrompt, ExamOcrQuestion } from '../prompts'
import { splitPdfToSinglePageBase64 } from '../pdf'
import {
  buildFileBlock, callClaudeText,
  parseJsonArrayResponse, parseJsonObjectResponse,
  type ContentBlock,
} from './client'

export type { ExamOcrQuestion }

export type ExamOcrResult = {
  question_number: number
  sub_label: string | null
  student_answer?: number
  student_answer_text?: string
}

export type ExamOmrAnswer = {
  question_number: number
  student_answer: number | null
}

export type ExamOmrPageResult = {
  page_number: number
  student_name: string | null
  answers: ExamOmrAnswer[]
  confidence: number
  warnings: string[]
}

export type ExamOcrBatchInput = {
  fileData: string
  mimeType: string
  fileName?: string
}

export type MockExamMetadataQuestion = {
  question_number: number
  correct_answer?: string | number | null
  points?: number | null
  section?: 'listening' | 'reading' | null
  question_type?: string | null
  difficulty?: 'low' | 'medium' | 'high' | null
  is_void?: boolean | null
  all_correct?: boolean | null
  extra_correct_answers?: (string | number)[] | null
}

export type MockExamMetadataFileInput = {
  fileData: string
  mimeType: string
  fileName?: string
}

// ── 모의고사 성적표용 메타데이터 파싱 ─────────────────────────────────────

const MOCK_EXAM_METADATA_RULES = `이 자료는 영어 모의고사 성적표 생성을 위한 메타데이터입니다.
시험지 PDF, 정답표, 해설지, 또는 강사가 정리한 텍스트일 수 있습니다.

목표:
- 1번부터 45번까지 각 문항의 성적표/채점용 메타데이터를 추출하세요.
- 문제 본문 전체를 복원하지 마세요. 성적표 생성에 필요한 정보만 추출하세요.
- 문제지와 답안지가 함께 제공되면 두 자료를 병합하세요. 문제지에서는 배점/유형을, 답안지에서는 정답을 우선 추출하세요.

필드:
- question_number: 1~45 정수
- correct_answer: 객관식 정답. ①~⑤는 "1"~"5"로 변환. 자료에 없으면 "".
- points: 배점. 문제지나 답안지에 적힌 배점을 우선 사용하세요. 자료에 없으면 일반적인 영어 모의고사 배점으로 추정하세요. 3점 문항은 3, 나머지는 2.
- section: 1~17번은 "listening", 18~45번은 "reading".
- question_type: 반드시 아래 실전 모의고사 유형명 중 하나로 출력하세요.
  듣기, 목적, 심경, 주장, 함축의미, 요지, 주제, 제목, 도표, 내용일치/불일치, 실용문, 어법, 어휘, 빈칸, 무관문장, 순서, 문장삽입, 요약, 장문-제목, 장문-어휘, 장문-순서, 장문-지칭, 장문-내용일치
  기본 번호 매핑:
  1~17 듣기
  18 목적, 19 심경, 20 주장, 21 함축의미, 22 요지, 23 주제, 24 제목
  25 도표, 26 내용일치/불일치, 27~28 실용문
  29 어법, 30 어휘, 31~34 빈칸, 35 무관문장, 36~37 순서, 38~39 문장삽입, 40 요약
  41 장문-제목, 42 장문-어휘, 43 장문-순서, 44 장문-지칭, 45 장문-내용일치
- difficulty: low, medium, high 중 하나. 확실하지 않으면 medium. 고난도/킬러/오답률 높음/3점 빈칸 등은 high.
- is_void: 정답 제외/무효 문항이면 true, 아니면 false.
- all_correct: 전원정답이면 true, 아니면 false.
- extra_correct_answers: 복수정답이 있으면 문자열 배열, 없으면 [].

규칙:
- 가능한 한 45개 객체를 모두 출력하세요.
- 자료에서 정답을 확인할 수 없으면 correct_answer는 ""로 두고, 유형/배점/영역은 추정해서 채우세요.
- 자료에서 배점이 확인되면 반드시 points에 반영하세요. "2점", "[3점]", "배점 3" 같은 표기를 놓치지 마세요.
- 절대 문제 본문, 보기 전체, 해설 전체를 길게 출력하지 마세요.
- JSON 배열만 출력하세요.

출력:
[{"question_number":1,"correct_answer":"3","points":2,"section":"listening","question_type":"듣기","difficulty":"medium","is_void":false,"all_correct":false,"extra_correct_answers":[]}]`

const MOCK_EXAM_ANSWER_KEY_RULES = `자료는 한국 영어 모의고사 정답표 또는 답안지 PDF입니다.

목표:
- 페이지 전체를 읽기 전에 문항별 정답/배점 표 영역을 먼저 찾으세요.
- "문항", "번호", "정답", "배점", "답", "점수" 같은 머리글이 있는 표를 우선하세요.
- 1~45번의 객관식 정답과 배점만 추출하세요.

규칙:
- correct_answer는 1~5 중 하나의 문자열입니다. ①~⑤, 1~5, 원형 숫자는 모두 "1"~"5"로 변환하세요.
- points는 2 또는 3입니다. 표에 배점이 없으면 해당 필드는 생략하세요.
- 해설 번호, 페이지 번호, 선택지 번호, 학생 답안 마킹을 정답으로 착각하지 마세요.
- 같은 문항이 여러 번 보이면 "정답표/답안" 표의 값을 우선하세요.
- 확실하지 않은 문항은 correct_answer를 ""로 두세요.
- JSON 배열만 출력하세요.

출력:
[{"question_number":1,"correct_answer":"3","points":2}]`

const MOCK_EXAM_FILE_ERROR = '지원하지 않는 파일 형식입니다. PDF 또는 이미지만 업로드해주세요.'

export async function parseMockExamMetadataFiles(
  files: MockExamMetadataFileInput[],
): Promise<MockExamMetadataQuestion[]> {
  if (files.length === 0) return []
  const content: ContentBlock[] = [
    {
      type: 'text',
      text: `${MOCK_EXAM_METADATA_RULES}

첨부 파일은 시험지, 정답표, 해설지 중 하나 이상입니다. 여러 파일이 있으면 서로 보완해서 1~45번 메타데이터를 하나의 JSON 배열로 합치세요.`,
    },
  ]

  for (const [index, file] of files.entries()) {
    content.push({
      type: 'text',
      text: `파일 ${index + 1}: ${file.fileName ?? '이름 없음'}`,
    })
    content.push(buildFileBlock(file.fileData, file.mimeType, MOCK_EXAM_FILE_ERROR))
  }

  const raw = await callClaudeText({ model: 'claude-sonnet-4-6', maxTokens: 8192, content })
  return parseJsonArrayResponse<MockExamMetadataQuestion>(raw, 'parseMockExamMetadataFiles')
}

export async function parseMockExamAnswerKeyFiles(
  files: MockExamMetadataFileInput[],
): Promise<MockExamMetadataQuestion[]> {
  if (files.length === 0) return []
  const content: ContentBlock[] = [
    { type: 'text', text: MOCK_EXAM_ANSWER_KEY_RULES } satisfies TextBlockParam,
  ]

  for (const [index, file] of files.entries()) {
    content.push({ type: 'text', text: `파일 ${index + 1}: ${file.fileName ?? 'answer-key'}` })
    content.push(buildFileBlock(file.fileData, file.mimeType, MOCK_EXAM_FILE_ERROR))
  }

  const raw = await callClaudeText({ model: 'claude-sonnet-4-6', maxTokens: 4096, content })
  return parseJsonArrayResponse<MockExamMetadataQuestion>(raw, 'parseMockExamAnswerKeyFiles')
}

export async function parseMockExamMetadataFile(
  fileData: string,
  mimeType: string,
): Promise<MockExamMetadataQuestion[]> {
  const raw = await callClaudeText({
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    content: [
      buildFileBlock(fileData, mimeType, MOCK_EXAM_FILE_ERROR),
      { type: 'text', text: MOCK_EXAM_METADATA_RULES },
    ],
  })
  return parseJsonArrayResponse<MockExamMetadataQuestion>(raw, 'parseMockExamMetadataFile')
}

export async function parseMockExamMetadataText(rawText: string): Promise<MockExamMetadataQuestion[]> {
  const raw = await callClaudeText({
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    content: `${MOCK_EXAM_METADATA_RULES}

[자료]
${rawText}`,
  })
  return parseJsonArrayResponse<MockExamMetadataQuestion>(raw, 'parseMockExamMetadataText')
}

// ── 시험 답안지 OCR ───────────────────────────────────────────────────────

export async function ocrExamAnswers(
  fileData: string,
  mimeType: string,
  questions: ExamOcrQuestion[],
): Promise<ExamOcrResult[]> {
  const fileContent = buildFileBlock(fileData, mimeType, MOCK_EXAM_FILE_ERROR)

  console.log('[ocrExamAnswers] Claude Vision OCR 사용')
  const raw = await callClaudeText({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    content: [fileContent, { type: 'text', text: buildExamOcrVisionPrompt(questions) }],
  })

  const parsed = parseJsonArrayResponse<ExamOcrResult>(raw, 'ocrExamAnswers')
  return normalizeExamOcrResults(parsed, questions)
}

function normalizeExamOcrResults(
  results: ExamOcrResult[],
  questions: ExamOcrQuestion[],
): ExamOcrResult[] {
  const questionMap = new Map(
    questions.map((question) => [
      `${question.question_number}|${question.sub_label ?? ''}`,
      question,
    ]),
  )

  return results.map((result) => {
    const question = questionMap.get(getExamOcrResultKey(result))
    if (question?.question_style !== 'multi_select') return result

    const normalizedText = normalizeMultiSelectOcrAnswer(
      result.student_answer_text ?? (typeof result.student_answer === 'number' ? String(result.student_answer) : ''),
    )

    return {
      question_number: result.question_number,
      sub_label: result.sub_label ?? null,
      student_answer_text: normalizedText,
    }
  })
}

function normalizeMultiSelectOcrAnswer(text: string): string {
  const symbolMap: Record<string, string> = {
    '①': '1',
    '②': '2',
    '③': '3',
    '④': '4',
    '⑤': '5',
  }

  const normalized = text.replace(/[①②③④⑤]/g, (match) => symbolMap[match] ?? match)
  const picks = [...new Set(normalized.match(/[1-5]/g) ?? [])]
    .sort((a, b) => Number(a) - Number(b))

  return picks.join(',')
}

function getExamOcrResultKey(result: ExamOcrResult): string {
  return `${result.question_number}|${result.sub_label ?? ''}`
}

function scoreExamOcrResult(result: ExamOcrResult): number {
  if (typeof result.student_answer === 'number') return 100
  const text = result.student_answer_text?.trim() ?? ''
  if (!text) return 0
  return Math.min(text.length, 80)
}

function mergeExamOcrResults(results: ExamOcrResult[][]): ExamOcrResult[] {
  const merged = new Map<string, ExamOcrResult>()

  for (const pageResults of results) {
    for (const result of pageResults) {
      const key = getExamOcrResultKey(result)
      const current = merged.get(key)
      if (!current || scoreExamOcrResult(result) > scoreExamOcrResult(current)) {
        merged.set(key, result)
      }
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (a.question_number !== b.question_number) return a.question_number - b.question_number
    return (a.sub_label ?? '').localeCompare(b.sub_label ?? '')
  })
}

// ── OMR 인식 ─────────────────────────────────────────────────────────────

function buildExamOmrVisionPrompt(questions: ExamOcrQuestion[], pageNumber: number, strict = false) {
  const questionNumbers = questions
    .map((question) => question.question_number)
    .filter((number) => Number.isFinite(number))
    .sort((a, b) => a - b)
  const firstQuestion = questionNumbers[0] ?? 1
  const lastQuestion = questionNumbers[questionNumbers.length - 1] ?? 45

  return `This is one scanned Korean CSAT/mock-exam OMR answer sheet page.

Task:
- First locate the OMR answer grid area. It is the area with visible question numbers and choice bubbles 1-5.
- Ignore student-number digit grids, school fields, supervisor fields, instructions, and barcode/marker blocks.
- Read the handwritten student name from the field labeled "성명", "이름", or "성 명".
- The student name is usually 2-4 Korean Hangul characters written inside or immediately next to that name box.
- Ignore the exam subject ("영어"), school name, printed labels, 수험번호 digit grid, and supervisor/감독 fields when reading the name.
- Read the marked objective answers for questions ${firstQuestion}-${lastQuestion}.
- The answer area is usually split into 1-20, 21-40, and 41-45. Each question has choices 1-5.
- The page may be rotated. Read it by the OMR card orientation, not by the uploaded image orientation.
${strict ? '- This is a retry because the first pass missed too many answers. Re-scan the answer grid only and return every visible question in order.' : ''}

Rules:
- Only dark filled bubbles count as selected answers.
- If a question has multiple dark marks or is ambiguous, use null.
- If a question is blank, use null.
- Do not use school, exam title, subject, supervisor, instructions, or 수험번호 as the student name.
- If the name field is blank or unreadable, use null. If it is visible but slightly uncertain, return the best Hangul guess and add a warning.
- Do not invent question numbers. Use the visible OMR question numbers.
- Return exactly one JSON object and no markdown.

Schema:
{
  "page_number": ${pageNumber},
  "student_name": "홍길동",
  "answers": [
    {"question_number": 1, "student_answer": 3},
    {"question_number": 2, "student_answer": null}
  ],
  "confidence": 0.0,
  "warnings": []
}`
}

type OmrNameOnlyResult = {
  student_name?: string | null
  confidence?: number
  warnings?: string[]
}

function buildExamOmrNameVisionPrompt(pageNumber: number) {
  return `This is page ${pageNumber} of a scanned Korean CSAT/mock-exam OMR answer sheet.

Read only the handwritten student name.

How to locate the name:
- Rotate mentally if needed and find the field labeled "성명", "성 명", or "이름".
- The name is usually handwritten in the blank box directly beside or under that label.
- It is usually 2-4 Hangul characters.

Ignore:
- 수험번호 / student-number digit grid
- 학교 / 출신학교 / school fields
- 과목 or subject text such as "영어"
- 감독관 / supervisor fields
- printed instructions, page numbers, barcode markers, answer bubbles

Rules:
- Return the best Hangul reading if the handwriting is visible.
- If the name box is blank or impossible to read, return null.
- Do not guess from any printed text outside the name box.
- Return exactly one JSON object and no markdown.

Schema:
{
  "student_name": "홍길동",
  "confidence": 0.0,
  "warnings": []
}`
}

function cleanOmrStudentName(value: unknown) {
  if (typeof value !== 'string') return null
  const cleaned = value
    .normalize('NFKC')
    .replace(/성\s*명|이름|학생명|수험자|성함|학교|과목|영어|감독|확인/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\p{Script=Hangul}A-Za-z]/gu, '')
  if (cleaned.length < 2 || cleaned.length > 10) return null
  return cleaned
}

function normalizeOmrPageResult(value: Partial<ExamOmrPageResult>, questions: ExamOcrQuestion[], pageNumber: number): ExamOmrPageResult {
  const allowed = new Set(questions.map((question) => question.question_number))
  const answers = Array.isArray(value.answers)
    ? value.answers
        .map((answer) => ({
          question_number: Number(answer?.question_number),
          student_answer: answer?.student_answer == null ? null : Number(answer.student_answer),
        }))
        .filter((answer) => allowed.has(answer.question_number))
        .map((answer) => ({
          question_number: answer.question_number,
          student_answer: answer.student_answer && answer.student_answer >= 1 && answer.student_answer <= 5
            ? answer.student_answer
            : null,
        }))
    : []

  const byQuestion = new Map(answers.map((answer) => [answer.question_number, answer]))
  const normalizedAnswers = questions.map((question) => byQuestion.get(question.question_number) ?? {
    question_number: question.question_number,
    student_answer: null,
  })
  const confidence = Number(value.confidence)

  return {
    page_number: pageNumber,
    student_name: cleanOmrStudentName(value.student_name),
    answers: normalizedAnswers,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    warnings: Array.isArray(value.warnings) ? value.warnings.map(String).filter(Boolean) : [],
  }
}

async function ocrExamOmrPage(
  fileData: string,
  mimeType: string,
  questions: ExamOcrQuestion[],
  pageNumber: number,
): Promise<ExamOmrPageResult> {
  const fileContent = buildFileBlock(fileData, mimeType, MOCK_EXAM_FILE_ERROR)

  async function readOmr(strict: boolean) {
    const raw = await callClaudeText({
      model: 'claude-sonnet-4-6',
      maxTokens: 4096,
      content: [fileContent, { type: 'text', text: buildExamOmrVisionPrompt(questions, pageNumber, strict) }],
    })
    const parsed = parseJsonObjectResponse<Partial<ExamOmrPageResult>>(raw, 'ocrExamOmrPage')
    return normalizeOmrPageResult(parsed, questions, pageNumber)
  }

  async function readNameOnly() {
    const raw = await callClaudeText({
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
      content: [fileContent, { type: 'text', text: buildExamOmrNameVisionPrompt(pageNumber) }],
    })
    const parsed = parseJsonObjectResponse<OmrNameOnlyResult>(raw, 'ocrExamOmrPage:이름')
    return {
      student_name: cleanOmrStudentName(parsed.student_name),
      confidence: Number(parsed.confidence),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).filter(Boolean) : [],
    }
  }

  const first = await readOmr(false)
  let result = first
  const answeredCount = first.answers.filter((answer) => answer.student_answer != null).length
  if (questions.length > 0 && answeredCount < Math.min(35, Math.ceil(questions.length * 0.75))) {
    const retry = await readOmr(true)
    const retryAnsweredCount = retry.answers.filter((answer) => answer.student_answer != null).length
    result = retryAnsweredCount > answeredCount
      ? { ...retry, warnings: [...retry.warnings, '첫 인식에서 답란 영역을 충분히 찾지 못해 답란 중심으로 재인식했습니다.'] }
      : { ...first, warnings: [...first.warnings, '답란 영역 인식이 불안정합니다. 원본 스캔 방향과 선명도를 확인해 주세요.'] }
  }

  if (!result.student_name) {
    const nameRetry = await readNameOnly().catch(() => null)
    if (nameRetry?.student_name) {
      result = {
        ...result,
        student_name: nameRetry.student_name,
        warnings: [...result.warnings, '성명 칸만 분리해서 재인식했습니다.', ...nameRetry.warnings],
      }
    } else {
      result = {
        ...result,
        warnings: [...result.warnings, '성명 칸 인식이 불안정합니다. 검수 화면에서 학생을 선택해 주세요.'],
      }
    }
  }

  return result
}

export async function ocrExamAnswerBatch(
  files: ExamOcrBatchInput[],
  questions: ExamOcrQuestion[],
): Promise<{ results: ExamOcrResult[]; pagesProcessed: number }> {
  const pageResults: ExamOcrResult[][] = []
  let pagesProcessed = 0

  for (const file of files) {
    if (file.mimeType === 'application/pdf') {
      const pages = await splitPdfToSinglePageBase64(file.fileData)
      for (const page of pages) {
        pageResults.push(await ocrExamAnswers(page, 'application/pdf', questions))
        pagesProcessed += 1
      }
      continue
    }

    pageResults.push(await ocrExamAnswers(file.fileData, file.mimeType, questions))
    pagesProcessed += 1
  }

  return {
    results: mergeExamOcrResults(pageResults),
    pagesProcessed,
  }
}

export async function ocrExamOmrBatch(
  files: ExamOcrBatchInput[],
  questions: ExamOcrQuestion[],
): Promise<{ results: ExamOmrPageResult[]; pagesProcessed: number }> {
  const results: ExamOmrPageResult[] = []
  let pagesProcessed = 0

  for (const file of files) {
    if (file.mimeType === 'application/pdf') {
      const pages = await splitPdfToSinglePageBase64(file.fileData)
      for (const page of pages) {
        pagesProcessed += 1
        results.push(await ocrExamOmrPage(page, 'application/pdf', questions, pagesProcessed))
      }
      continue
    }

    pagesProcessed += 1
    results.push(await ocrExamOmrPage(file.fileData, file.mimeType, questions, pagesProcessed))
  }

  return { results, pagesProcessed }
}
