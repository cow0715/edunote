import { z } from 'zod'
import { jsonrepair } from 'jsonrepair'
import { anthropic } from '@/lib/anthropic'
import { err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 300

const analysisSchema = z.object({
  summary: z.object({
    analyzedPassageCount: z.number(),
    totalQuestions: z.number(),
    avgSurfaceChangeScore: z.number(),
    avgStructureChangeScore: z.number(),
    avgExamAdaptationScore: z.number(),
    difficulty: z.enum(['low', 'low-medium', 'medium', 'medium-high', 'high']),
    topPatterns: z.array(z.string()).default([]),
    keyInsight: z.string(),
  }),
  passages: z.array(z.object({
    questionRange: z.string(),
    matchedOriginalLabel: z.string(),
    matchConfidence: z.number(),
    surfaceChangeScore: z.number(),
    structureChangeScore: z.number(),
    examAdaptationScore: z.number(),
    questionTypes: z.array(z.string()).default([]),
    modificationTypes: z.array(z.string()).default([]),
    hasNewlyAuthoredContent: z.boolean(),
    deletedContent: z.array(z.string()).default([]),
    addedContent: z.array(z.string()).default([]),
    evidenceComparisons: z.array(z.object({
      original: z.string(),
      exam: z.string(),
      changeType: z.string(),
      commentary: z.string(),
    })).default([]),
  })).default([]),
  questionAnalysis: z.object({
    typeDistribution: z.array(z.object({
      type: z.string(),
      count: z.number(),
      percentage: z.number(),
    })).default([]),
    difficultyDistribution: z.object({
      high: z.number(),
      medium: z.number(),
      low: z.number(),
    }),
    hardQuestions: z.array(z.object({
      questionNumber: z.string(),
      reason: z.string(),
      relatedPassage: z.string(),
    })).default([]),
  }),
  teachingStrategy: z.array(z.object({
    priority: z.number(),
    title: z.string(),
    description: z.string(),
    teacherTalkingPoint: z.string(),
  })).default([]),
})

const ANALYSIS_PROMPT = `첫 번째 문서는 원문 PDF입니다.
두 번째 문서는 실제 시험 PDF입니다.

당신의 역할은 학원 강사가 설명회에서 바로 활용할 수 있는 "시험 변형 분석 리포트"를 만드는 것입니다.
핵심 목표는 "교과서 원문이 실제 시험에서 어떻게 가공되었는지"를 숫자와 근거 문장으로 보여주는 것입니다.

반드시 아래 순서대로 사고하고, 최종 출력은 JSON 하나만 하세요.

[1단계: 시험 지문 묶음 식별 및 원문 매칭]
1. 시험 PDF를 읽고 같은 지문을 공유하는 문항 범위를 먼저 묶으세요.
   - 예: "1~2번", "3번", "4~5번"
2. 각 시험 지문 묶음이 원문 PDF의 어느 부분에서 왔는지 찾으세요.
3. 원문 일부를 요약하거나 축약한 경우에도 매칭을 시도하세요.
4. 원문에 없는 문장이 시험용으로 새로 생성된 경우, 그 사실을 반영하세요.
5. 매칭이 애매하면 억지로 단정하지 말고 matchConfidence를 낮게 주세요.

[2단계: 변형 및 출제 분석]
각 시험 지문 묶음마다 아래를 분석하세요.
- matchConfidence: 원문 매칭 확실도 0~100
- surfaceChangeScore: 어휘/표현/어순 수준 변형도 0~100
- structureChangeScore: 문장 결합, 절 삽입, 순서 재구성 정도 0~100
- examAdaptationScore: 어법 포인트 삽입, 빈칸용 결말 교체, 신규 문장 생성 등 시험형 가공도 0~100
- questionTypes: 해당 묶음과 연결된 문항 유형
- modificationTypes: 변형 유형 태그
- hasNewlyAuthoredContent: 원문에 없는 시험용 신규 문장/문단이 있으면 true
- deletedContent: 원문에 있었지만 시험에서 빠진 핵심 내용 2~3개
- addedContent: 시험에서 새로 추가되거나 강하게 변형된 핵심 내용 2~3개
- evidenceComparisons: 가장 대표적인 비교 문장 1~3개
  - original: 원문 문장 또는 표현
  - exam: 시험에서 대응되는 문장 또는 표현
  - changeType: 변화 유형 요약
  - commentary: 왜 중요한 변화인지 설명

[3단계: 문항 분석 및 수업 전략]
1. 전체 문항 유형 분포를 계산하세요.
2. 난도는 감상적으로 말하지 말고, 변형 강도와 요구 사고 과정을 기준으로 low / medium / high로 분류하세요.
3. 고난도 문항은 이유와 연결 지문 묶음을 함께 제시하세요.
4. teachingStrategy는 우선순위 1부터 시작해 3~4개를 제안하세요.
5. teacherTalkingPoint는 설명회에서 강사가 바로 읽어도 되는 한 문장으로 작성하세요.

[중요 규칙]
- 지문 묶음 단위로 분석하세요. 문항 하나씩 따로 쪼개지 마세요.
- 증거 없이 과장하지 마세요.
- 숫자는 정수로 주세요.
- difficulty는 반드시 다음 중 하나만 사용하세요:
  "low", "low-medium", "medium", "medium-high", "high"
- modificationTypes 예시:
  "패러프레이징", "동의어 치환", "문장 결합", "절 추가", "도입부 삭제",
  "결말 교체", "논리어 재구성", "요약 압축", "시험형 재구성", "신규 문장 생성"

반드시 아래 JSON 형식만 출력하세요.
{
  "summary": {
    "analyzedPassageCount": 0,
    "totalQuestions": 0,
    "avgSurfaceChangeScore": 0,
    "avgStructureChangeScore": 0,
    "avgExamAdaptationScore": 0,
    "difficulty": "medium",
    "topPatterns": ["패러프레이징"],
    "keyInsight": ""
  },
  "passages": [
    {
      "questionRange": "1~2번",
      "matchedOriginalLabel": "원문 1~2번 지문",
      "matchConfidence": 0,
      "surfaceChangeScore": 0,
      "structureChangeScore": 0,
      "examAdaptationScore": 0,
      "questionTypes": ["어법", "빈칸"],
      "modificationTypes": ["패러프레이징"],
      "hasNewlyAuthoredContent": false,
      "deletedContent": [""],
      "addedContent": [""],
      "evidenceComparisons": [
        {
          "original": "",
          "exam": "",
          "changeType": "",
          "commentary": ""
        }
      ]
    }
  ],
  "questionAnalysis": {
    "typeDistribution": [
      { "type": "어법", "count": 0, "percentage": 0 }
    ],
    "difficultyDistribution": {
      "high": 0,
      "medium": 0,
      "low": 0
    },
    "hardQuestions": [
      {
        "questionNumber": "3번",
        "reason": "",
        "relatedPassage": "3번"
      }
    ]
  },
  "teachingStrategy": [
    {
      "priority": 1,
      "title": "",
      "description": "",
      "teacherTalkingPoint": ""
    }
  ]
}`

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  return Buffer.from(buffer).toString('base64')
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeResult(input: z.infer<typeof analysisSchema>) {
  return {
    summary: {
      analyzedPassageCount: Math.max(0, Math.round(input.summary.analyzedPassageCount)),
      totalQuestions: Math.max(0, Math.round(input.summary.totalQuestions)),
      avgSurfaceChangeScore: clampScore(input.summary.avgSurfaceChangeScore),
      avgStructureChangeScore: clampScore(input.summary.avgStructureChangeScore),
      avgExamAdaptationScore: clampScore(input.summary.avgExamAdaptationScore),
      difficulty: input.summary.difficulty,
      topPatterns: input.summary.topPatterns.slice(0, 5),
      keyInsight: input.summary.keyInsight.trim(),
    },
    passages: input.passages.map((passage) => ({
      questionRange: passage.questionRange.trim(),
      matchedOriginalLabel: passage.matchedOriginalLabel.trim(),
      matchConfidence: clampScore(passage.matchConfidence),
      surfaceChangeScore: clampScore(passage.surfaceChangeScore),
      structureChangeScore: clampScore(passage.structureChangeScore),
      examAdaptationScore: clampScore(passage.examAdaptationScore),
      questionTypes: passage.questionTypes.filter(Boolean),
      modificationTypes: passage.modificationTypes.filter(Boolean),
      hasNewlyAuthoredContent: passage.hasNewlyAuthoredContent,
      deletedContent: passage.deletedContent.filter(Boolean).slice(0, 3),
      addedContent: passage.addedContent.filter(Boolean).slice(0, 3),
      evidenceComparisons: passage.evidenceComparisons
        .filter((item) => item.original || item.exam || item.commentary)
        .slice(0, 3)
        .map((item) => ({
          original: item.original.trim(),
          exam: item.exam.trim(),
          changeType: item.changeType.trim(),
          commentary: item.commentary.trim(),
        })),
    })),
    questionAnalysis: {
      typeDistribution: input.questionAnalysis.typeDistribution
        .map((item) => ({
          type: item.type.trim(),
          count: Math.max(0, Math.round(item.count)),
          percentage: clampScore(item.percentage),
        }))
        .filter((item) => item.type),
      difficultyDistribution: {
        high: Math.max(0, Math.round(input.questionAnalysis.difficultyDistribution.high)),
        medium: Math.max(0, Math.round(input.questionAnalysis.difficultyDistribution.medium)),
        low: Math.max(0, Math.round(input.questionAnalysis.difficultyDistribution.low)),
      },
      hardQuestions: input.questionAnalysis.hardQuestions
        .filter((item) => item.questionNumber || item.reason)
        .slice(0, 6)
        .map((item) => ({
          questionNumber: item.questionNumber.trim(),
          reason: item.reason.trim(),
          relatedPassage: item.relatedPassage.trim(),
        })),
    },
    teachingStrategy: input.teachingStrategy
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 4)
      .map((item, index) => ({
        priority: index + 1,
        title: item.title.trim(),
        description: item.description.trim(),
        teacherTalkingPoint: item.teacherTalkingPoint.trim(),
      })),
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

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: originalBase64 } },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: examBase64 } },
          { type: 'text', text: ANALYSIS_PROMPT },
        ],
      }],
    })

    const message = await stream.finalMessage()
    const rawText = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n').trim()
    const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim()
    const repaired = jsonrepair(cleaned)
    const parsed = JSON.parse(repaired)
    const result = normalizeResult(analysisSchema.parse(parsed))

    return ok(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return err(`시험 변형 분석 실패: ${message}`, 500)
  }
}
