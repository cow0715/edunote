import { z } from 'zod'
import { jsonrepair } from 'jsonrepair'
import { anthropic } from '@/lib/anthropic'
import { err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 300

const nonEmptyString = z.string().trim().min(1)
const difficultyEnum = z.enum(['low', 'low-medium', 'medium', 'medium-high', 'high'])
const questionDifficultyEnum = z.enum(['low', 'medium', 'high'])

const outlineSchema = z.object({
  totalQuestions: z.number().int().positive(),
  groups: z.array(z.object({
    questionRange: nonEmptyString,
    questionNumbers: z.array(z.number().int().positive()),
    matchedOriginalLabel: nonEmptyString,
  })).min(1),
})

const passageDetailSchema = z.object({
  questionRange: nonEmptyString,
  questionNumbers: z.array(z.number().int().positive()).min(1),
  matchedOriginalLabel: nonEmptyString,
  matchConfidence: z.number(),
  surfaceChangeScore: z.number(),
  structureChangeScore: z.number(),
  examAdaptationScore: z.number(),
  questions: z.array(z.object({
    questionNumber: z.number().int().positive(),
    type: nonEmptyString,
    difficulty: questionDifficultyEnum,
    reason: nonEmptyString,
  })).min(1),
  modificationTypes: z.array(nonEmptyString).min(1),
  hasNewlyAuthoredContent: z.boolean(),
  deletedContent: z.array(nonEmptyString).min(1).max(3),
  addedContent: z.array(nonEmptyString).min(1).max(3),
  evidenceComparisons: z.array(z.object({
    original: nonEmptyString,
    exam: nonEmptyString,
    changeType: nonEmptyString,
    commentary: nonEmptyString,
  })).min(1).max(3),
})

const passageBatchSchema = z.object({
  passages: z.array(passageDetailSchema).min(1),
})

const synthesisSchema = z.object({
  difficulty: difficultyEnum,
  topPatterns: z.array(nonEmptyString).min(1).max(5),
  keyInsight: nonEmptyString,
  teachingStrategy: z.array(z.object({
    priority: z.number().int().positive(),
    title: nonEmptyString,
    description: nonEmptyString,
    teacherTalkingPoint: nonEmptyString,
  })).min(3).max(4),
})

type OutlineResult = z.infer<typeof outlineSchema>
type PassageDetail = z.infer<typeof passageDetailSchema>

const ANALYSIS_MODEL = 'claude-opus-4-7'

function buildOutlinePrompt(feedback?: string) {
  const retrySection = feedback
    ? `이전 개요 추출 결과가 잘못되었습니다. 아래 문제를 모두 반영해서 전체 개요를 처음부터 다시 생성하세요.

문제 목록:
${feedback}

누락이나 중복을 만든 기존 그룹핑을 그대로 유지하지 마세요.
`
    : ''

  return `당신은 학원 강사를 위한 "시험 변형 분석 리포트"의 개요를 만드는 역할입니다.

입력 문서:
1. 원문 PDF
2. 실제 시험 PDF

작업:
- 시험 PDF를 처음부터 끝까지 읽고 모든 문항을 식별하세요.
- 같은 지문이나 같은 원문을 공유하는 문항끼리 묶으세요.
- 각 묶음을 원문 PDF의 대응 구간과 연결하세요.

규칙:
- 모든 시험 문항은 반드시 한 번씩만 하나의 그룹에 포함되어야 합니다.
- questionNumbers에는 실제 문항 번호를 정수 배열로 넣으세요.
- questionRange는 "1~2", "3", "4~5", "서답형1"처럼 사람이 읽기 쉬운 형태로 쓰세요.
- matchedOriginalLabel은 강사가 이해하기 쉬운 한국어 설명으로 작성하세요.
- 시험 전용으로 새로 만들어진 내용이 섞여 있어도, 가장 가까운 원문 출처를 찾아 매칭하세요.
- 아래 스키마 외의 필드는 출력하지 마세요.
- 모든 문자열 설명은 한국어로 작성하세요.

${retrySection}

JSON만 출력하세요:
{
  "totalQuestions": 30,
  "groups": [
    {
      "questionRange": "1~2",
      "questionNumbers": [1, 2],
      "matchedOriginalLabel": "원문 1~2번 지문"
    }
  ]
}`
}

function buildPassageBatchPrompt(batch: OutlineResult['groups']) {
  const batchDescription = batch
    .map((group) => `- ${group.questionRange} | questionNumbers=${JSON.stringify(group.questionNumbers)} | matchedOriginalLabel=${group.matchedOriginalLabel}`)
    .join('\n')

  return `당신은 "시험 변형 분석 리포트"를 위해 특정 지문 묶음을 분석하는 역할입니다.

아래에 적힌 지문 묶음만 분석하세요. 다른 묶음은 무시하세요.

${batchDescription}

규칙:
- questionRange는 입력된 값을 그대로 유지하세요.
- questionNumbers는 입력된 값을 그대로 유지하고, questions 배열 안에서도 같은 번호를 모두 포함하세요.
- matchedOriginalLabel도 입력된 값을 그대로 유지하세요.
- matchConfidence, surfaceChangeScore, structureChangeScore, examAdaptationScore는 0~100 정수로 작성하세요.
- questions는 문항 번호당 정확히 1개씩 있어야 합니다.
- 각 question에는 반드시 아래 필드가 있어야 합니다:
  - questionNumber
  - type
  - difficulty: low | medium | high
  - reason
- type과 reason은 반드시 한국어로 작성하세요.
- modificationTypes는 최소 1개 이상, 한국어 태그로 작성하세요.
- deletedContent와 addedContent는 각각 1~3개 구체 항목으로 작성하세요.
- evidenceComparisons는 1~3개이며, 각 항목은 네 필드(original, exam, changeType, commentary)를 모두 채워야 합니다.
- changeType과 commentary는 한국어로 작성하세요.
- 시험에 원문에 없는 신규 문장/문단이 있으면 hasNewlyAuthoredContent를 true로 두세요.

JSON만 출력하세요:
{
  "passages": [
    {
      "questionRange": "1~2",
      "questionNumbers": [1, 2],
      "matchedOriginalLabel": "원문 1~2번 지문",
      "matchConfidence": 92,
      "surfaceChangeScore": 78,
      "structureChangeScore": 64,
      "examAdaptationScore": 88,
      "questions": [
        {
          "questionNumber": 1,
          "type": "어법",
          "difficulty": "high",
          "reason": "변형된 문장 구조 속에서 어법 오류를 찾아야 해 난도가 높다."
        },
        {
          "questionNumber": 2,
          "type": "빈칸 추론",
          "difficulty": "medium",
          "reason": "결론 문장이 시험형 빈칸으로 재구성되어 흐름 추론이 필요하다."
        }
      ],
      "modificationTypes": ["패러프레이징", "결말 교체"],
      "hasNewlyAuthoredContent": false,
      "deletedContent": ["도입 인용문 삭제"],
      "addedContent": ["빈칸형 결말 삽입"],
      "evidenceComparisons": [
        {
          "original": "원문 문장",
          "exam": "시험 변형 문장",
          "changeType": "명사구화 + 동의어 치환",
          "commentary": "원문의 핵심 의미는 유지하면서 표현을 더 추상적으로 바꿔 체감 난도를 높였다."
        }
      ]
    }
  ]
}`
}

function buildSynthesisPrompt(passages: ReturnType<typeof normalizePassages>) {
  return `당신은 학원 강사를 위한 최종 "시험 변형 분석 리포트" 요약을 작성하는 역할입니다.

아래는 전체 지문 묶음 분석 결과를 구조화한 데이터입니다:
${JSON.stringify(passages, null, 2)}

아래 항목을 생성하세요:
- overall difficulty: low | low-medium | medium | medium-high | high
- topPatterns: 3~5개의 한국어 패턴 라벨
- keyInsight: 강사가 설명회에서 바로 활용할 수 있는 밀도 높은 한국어 요약 1문단
- teachingStrategy: 우선순위 3~4개

규칙:
- 반드시 제공된 데이터만 바탕으로 작성하세요.
- 학교가 원문을 어떤 방식으로 변형했는지와, 강사가 무엇을 가르쳐야 하는지에 집중하세요.
- 모든 설명은 한국어로 작성하세요.
- teacherTalkingPoint는 학부모 설명회에서 강사가 그대로 읽어도 되는 자연스러운 한국어 문장이어야 합니다.

JSON만 출력하세요:
{
  "difficulty": "medium-high",
  "topPatterns": ["패러프레이징", "문장 구조 재구성", "시험형 가공"],
  "keyInsight": "요약 문장",
  "teachingStrategy": [
    {
      "priority": 1,
      "title": "전략 제목",
      "description": "전략 설명",
      "teacherTalkingPoint": "설명회 멘트"
    }
  ]
}`
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  return Buffer.from(buffer).toString('base64')
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function sortNumbers(values: number[]) {
  return [...values].sort((a, b) => a - b)
}

function requestJsonPromptResult<T>(schema: z.ZodType<T>, rawText: string) {
  const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim()
  const repaired = jsonrepair(cleaned)
  return schema.parse(JSON.parse(repaired))
}

async function requestWithDocuments<T>(
  schema: z.ZodType<T>,
  originalBase64: string,
  examBase64: string,
  prompt: string,
) {
  const response = await anthropic.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 6000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: originalBase64 } },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: examBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
  })

  const rawText = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n').trim()
  return requestJsonPromptResult(schema, rawText)
}

async function requestTextOnly<T>(schema: z.ZodType<T>, prompt: string) {
  const response = await anthropic.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  })

  const rawText = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n').trim()
  return requestJsonPromptResult(schema, rawText)
}

function validateOutline(outline: OutlineResult) {
  const issues: string[] = []
  const flatNumbers = outline.groups.flatMap((group) => group.questionNumbers)
  const uniqueNumbers = new Set(flatNumbers)

  if (flatNumbers.length !== uniqueNumbers.size) {
    issues.push('Outline contains duplicated question numbers across groups.')
  }

  if (flatNumbers.length !== outline.totalQuestions) {
    issues.push(`Outline question count mismatch: grouped ${flatNumbers.length}, expected ${outline.totalQuestions}.`)
  }

  return issues
}

function describeOutlineIssues(outline: OutlineResult) {
  const issues = validateOutline(outline)
  const flatNumbers = outline.groups.flatMap((group) => group.questionNumbers)
  const counts = new Map<number, number>()

  for (const questionNumber of flatNumbers) {
    counts.set(questionNumber, (counts.get(questionNumber) ?? 0) + 1)
  }

  const duplicated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([questionNumber, count]) => `${questionNumber} (x${count})`)

  if (duplicated.length > 0) {
    issues.push(`Duplicated question numbers: ${duplicated.join(', ')}.`)
  }

  if (outline.totalQuestions > 0) {
    const missing: number[] = []
    for (let questionNumber = 1; questionNumber <= outline.totalQuestions; questionNumber++) {
      if (!counts.has(questionNumber)) missing.push(questionNumber)
    }

    if (missing.length > 0) {
      issues.push(`Missing question numbers: ${missing.join(', ')}.`)
    }
  }

  return issues
}

function validatePassageDetail(group: OutlineResult['groups'][number], detail: PassageDetail) {
  const issues: string[] = []
  const expectedNumbers = sortNumbers(group.questionNumbers)
  const actualNumbers = sortNumbers(detail.questionNumbers)
  const questionNumbersFromQuestions = sortNumbers(detail.questions.map((question) => question.questionNumber))

  if (detail.questionRange !== group.questionRange) {
    issues.push(`questionRange mismatch for ${group.questionRange}.`)
  }

  if (detail.matchedOriginalLabel !== group.matchedOriginalLabel) {
    issues.push(`matchedOriginalLabel mismatch for ${group.questionRange}.`)
  }

  if (JSON.stringify(expectedNumbers) !== JSON.stringify(actualNumbers)) {
    issues.push(
      `questionNumbers mismatch for ${group.questionRange}: expected ${JSON.stringify(expectedNumbers)}, got ${JSON.stringify(actualNumbers)}.`
    )
  }

  if (JSON.stringify(expectedNumbers) !== JSON.stringify(questionNumbersFromQuestions)) {
    issues.push(
      `questions[].questionNumber mismatch for ${group.questionRange}: expected ${JSON.stringify(expectedNumbers)}, got ${JSON.stringify(questionNumbersFromQuestions)}.`
    )
  }

  return issues
}

function chunkGroups(groups: OutlineResult['groups'], size: number) {
  const chunks: OutlineResult['groups'][] = []
  for (let index = 0; index < groups.length; index += size) {
    chunks.push(groups.slice(index, index + size))
  }
  return chunks
}

function normalizePassages(passages: PassageDetail[]) {
  return passages.map((passage) => {
    const questionTypes = uniqueStrings(passage.questions.map((question) => question.type))
    return {
      questionRange: passage.questionRange,
      questionNumbers: sortNumbers(passage.questionNumbers),
      matchedOriginalLabel: passage.matchedOriginalLabel,
      matchConfidence: clampScore(passage.matchConfidence),
      surfaceChangeScore: clampScore(passage.surfaceChangeScore),
      structureChangeScore: clampScore(passage.structureChangeScore),
      examAdaptationScore: clampScore(passage.examAdaptationScore),
      questionTypes,
      questions: passage.questions.map((question) => ({
        questionNumber: question.questionNumber,
        type: question.type,
        difficulty: question.difficulty,
        reason: question.reason,
      })),
      modificationTypes: uniqueStrings(passage.modificationTypes),
      hasNewlyAuthoredContent: passage.hasNewlyAuthoredContent,
      deletedContent: passage.deletedContent.slice(0, 3),
      addedContent: passage.addedContent.slice(0, 3),
      evidenceComparisons: passage.evidenceComparisons.slice(0, 3).map((item) => ({
        original: item.original,
        exam: item.exam,
        changeType: item.changeType,
        commentary: item.commentary,
      })),
    }
  })
}

function buildQuestionAnalysis(passages: ReturnType<typeof normalizePassages>, totalQuestions: number) {
  const allQuestions = passages.flatMap((passage) =>
    passage.questions.map((question) => ({
      ...question,
      relatedPassage: passage.questionRange,
    }))
  )

  const typeCounts = new Map<string, number>()
  for (const question of allQuestions) {
    typeCounts.set(question.type, (typeCounts.get(question.type) ?? 0) + 1)
  }

  const typeDistribution = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      count,
      percentage: totalQuestions > 0 ? Math.round((count / totalQuestions) * 100) : 0,
    }))

  const difficultyDistribution = {
    high: allQuestions.filter((question) => question.difficulty === 'high').length,
    medium: allQuestions.filter((question) => question.difficulty === 'medium').length,
    low: allQuestions.filter((question) => question.difficulty === 'low').length,
  }

  const hardQuestions = allQuestions
    .filter((question) => question.difficulty === 'high')
    .slice(0, 8)
    .map((question) => ({
      questionNumber: `${question.questionNumber}번`,
      reason: question.reason,
      relatedPassage: question.relatedPassage,
    }))

  return {
    typeDistribution,
    difficultyDistribution,
    hardQuestions,
  }
}

export async function POST(request: Request) {
  try {
    const { originalPath, examPath } = await request.json()
    if (!originalPath || !examPath) {
      return err('원문과 시험지 파일 경로가 모두 필요합니다.')
    }

    const supabase = createServiceClient()
    const [{ data: originalBlob, error: originalError }, { data: examBlob, error: examError }] = await Promise.all([
      supabase.storage.from('pdf-temp').download(originalPath),
      supabase.storage.from('pdf-temp').download(examPath),
    ])

    if (originalError || !originalBlob) {
      return err(`원문 파일 다운로드 실패: ${originalError?.message}`)
    }
    if (examError || !examBlob) {
      return err(`시험지 파일 다운로드 실패: ${examError?.message}`)
    }

    const [originalBase64, examBase64] = await Promise.all([
      blobToBase64(originalBlob),
      blobToBase64(examBlob),
    ])

    await Promise.all([
      supabase.storage.from('pdf-temp').remove([originalPath]).catch(() => {}),
      supabase.storage.from('pdf-temp').remove([examPath]).catch(() => {}),
    ])

    let outline: OutlineResult | null = null
    let outlineFeedback: string | undefined

    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await requestWithDocuments(
        outlineSchema,
        originalBase64,
        examBase64,
        buildOutlinePrompt(outlineFeedback),
      )
      const outlineIssues = describeOutlineIssues(candidate)
      if (outlineIssues.length === 0) {
        outline = candidate
        break
      }
      outlineFeedback = outlineIssues.join('\n')
    }

    if (!outline) {
      return err('시험 변형 분석 실패: 문항 개요를 완전하게 추출하지 못했습니다. 다시 시도해주세요.', 500)
    }

    const batches = chunkGroups(outline.groups, 6)
    const batchResults = await Promise.all(
      batches.map(async (batch) => {
        const batchResult = await requestWithDocuments(
          passageBatchSchema,
          originalBase64,
          examBase64,
          buildPassageBatchPrompt(batch),
        )

        const missingRanges = batch
          .filter((group) => !batchResult.passages.some((passage) => passage.questionRange === group.questionRange))
          .map((group) => group.questionRange)

        if (missingRanges.length > 0) {
          throw new Error(`다음 지문 묶음이 응답에서 누락되었습니다: ${missingRanges.join(', ')}`)
        }

        const details: PassageDetail[] = []
        for (const group of batch) {
          const detail = batchResult.passages.find((passage) => passage.questionRange === group.questionRange)
          if (!detail) continue

          const issues = validatePassageDetail(group, detail)
          if (issues.length > 0) {
            throw new Error(issues.join(' '))
          }

          details.push(detail)
        }

        return details
      })
    )

    const allPassages = batchResults.flat()

    const normalizedPassages = normalizePassages(allPassages)
      .sort((a, b) => a.questionNumbers[0] - b.questionNumbers[0])

    const questionAnalysis = buildQuestionAnalysis(normalizedPassages, outline.totalQuestions)
    const synthesis = await requestTextOnly(
      synthesisSchema,
      buildSynthesisPrompt(normalizedPassages),
    )

    const avgSurfaceChangeScore =
      normalizedPassages.length > 0
        ? Math.round(normalizedPassages.reduce((sum, passage) => sum + passage.surfaceChangeScore, 0) / normalizedPassages.length)
        : 0

    const avgStructureChangeScore =
      normalizedPassages.length > 0
        ? Math.round(normalizedPassages.reduce((sum, passage) => sum + passage.structureChangeScore, 0) / normalizedPassages.length)
        : 0

    const avgExamAdaptationScore =
      normalizedPassages.length > 0
        ? Math.round(normalizedPassages.reduce((sum, passage) => sum + passage.examAdaptationScore, 0) / normalizedPassages.length)
        : 0

    return ok({
      summary: {
        analyzedPassageCount: normalizedPassages.length,
        totalQuestions: outline.totalQuestions,
        avgSurfaceChangeScore,
        avgStructureChangeScore,
        avgExamAdaptationScore,
        difficulty: synthesis.difficulty,
        topPatterns: synthesis.topPatterns,
        keyInsight: synthesis.keyInsight,
      },
      passages: normalizedPassages.map((passage) => ({
        questionRange: passage.questionRange,
        matchedOriginalLabel: passage.matchedOriginalLabel,
        matchConfidence: passage.matchConfidence,
        surfaceChangeScore: passage.surfaceChangeScore,
        structureChangeScore: passage.structureChangeScore,
        examAdaptationScore: passage.examAdaptationScore,
        questionTypes: passage.questionTypes,
        modificationTypes: passage.modificationTypes,
        hasNewlyAuthoredContent: passage.hasNewlyAuthoredContent,
        deletedContent: passage.deletedContent,
        addedContent: passage.addedContent,
        evidenceComparisons: passage.evidenceComparisons,
      })),
      questionAnalysis,
      teachingStrategy: synthesis.teachingStrategy
        .sort((a, b) => a.priority - b.priority)
        .map((item, index) => ({
          priority: index + 1,
          title: item.title,
          description: item.description,
          teacherTalkingPoint: item.teacherTalkingPoint,
        })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return err(`시험 변형 분석 실패: ${message}`, 500)
  }
}
