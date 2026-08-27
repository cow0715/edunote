// ── 기출문제 은행: 시험지 파싱 + 해설 생성/추출 ─────────────────────────────

import { jsonrepair } from 'jsonrepair'
import { mapWithConcurrency } from '../concurrency'
import { EXAM_BANK_PARSE_RULES } from '../prompts'
import type { ParsedExplanation } from '../explanation-parser'
import { buildFileBlock, callClaudeText, callClaudeTextDetailed, extractJsonArrayCandidate, isContentFilterError, parseJsonArrayResponse, type CallClaudeUsage, type ContentBlock } from './client'

export type ExamBankParsedQuestion = {
  question_number: number
  question_type: string
  passage: string
  question_text: string
  choices: string[]
  answer: string
}

export async function parseExamBankPage(
  fileData: string,
  mimeType: string,
): Promise<ExamBankParsedQuestion[]> {
  const fileContent = buildFileBlock(fileData, mimeType, '지원하지 않는 파일 형식 (PDF 또는 이미지만 가능)')

  const raw = await callClaudeText({
    model: 'claude-sonnet-4-6',
    maxTokens: 32768,
    stream: true,
    content: [fileContent, { type: 'text', text: EXAM_BANK_PARSE_RULES }],
  })
  console.log('[parseExamBankPage] raw response length:', raw.length)

  const parsed = parseJsonArrayResponse<ExamBankParsedQuestion>(raw, 'parseExamBankPage')
  console.log('[parseExamBankPage] parsed count:', parsed.length, '| questions:', parsed.map(p => p.question_number).join(', '))
  return parsed
}

// ── 기출 문제지 출력 범위 분할 파싱 ──────────────────────────────────────
// 문항 번호가 18~45 로 고정된 기출이라 출력 범위를 선험적으로 나눌 수 있다.
// 41~45 장문 세트는 한 범위로 묶지만, 매 콜 문서 전체를 보므로 세트가 갈라져도 지문은 온전하다.
// 콘텐츠 필터는 출력 기준이라 걸린 범위 콜만 실패 — 그 범위만 skip 하고 결손 번호를 보고한다.

const EXAM_BANK_QUESTION_RANGES: [number, number][] = [[18, 23], [24, 29], [30, 35], [36, 40], [41, 45]]

export type ExamBankRangedResult = {
  items: ExamBankParsedQuestion[]
  calls: ExplanationCallStats[]
  /** 콘텐츠 필터로 통째 skip 된 범위들 — 해당 번호 문항은 결손 */
  skippedRanges: [number, number][]
}

/**
 * 도표 문항 껍데기 판별: "범위 지시"가 프롬프트의 도표 제외 규칙을 이기고
 * 지문 없는 도표 문항을 출력하는 경우가 실측됨(모평 25번) — 프롬프트에 맡기지 않고 코드로 거른다.
 */
export function isChartShellQuestion(question: Pick<ExamBankParsedQuestion, 'passage' | 'question_text'>): boolean {
  return !(question.passage ?? '').trim() && /도표|그래프/.test(question.question_text ?? '')
}

/** 기출 문제지 파싱: 캐시 예열(출력 0) → 5범위 병렬. 실측(8p 모평): whole 256s → 입력 청킹 133s → 69s */
export async function parseExamBankPageRanged(
  fileData: string,
  mimeType: string,
): Promise<ExamBankRangedResult> {
  const model = 'claude-sonnet-4-6'
  const warmStats = await prewarmPdfCache({ base64: fileData, mimeType, model, prompt: EXAM_BANK_PARSE_RULES })

  const skippedRanges: [number, number][] = []
  const parts = await Promise.all(EXAM_BANK_QUESTION_RANGES.map(async (range) => {
    try {
      return await rangedParseCall<ExamBankParsedQuestion>({
        base64: fileData, mimeType, model, maxTokens: 8192,
        prompt: EXAM_BANK_PARSE_RULES, range, label: 'parseExamBankPageRanged',
      })
    } catch (error) {
      // 필터(결정적)는 그 범위만 결손 처리 — 재시도해도 같은 출력 요구라 결과가 안 바뀐다
      if (!isContentFilterError(error)) throw error
      console.warn(`[parseExamBankPageRanged] ${range[0]}~${range[1]}번 범위 필터 skip:`, error instanceof Error ? error.message : error)
      skippedRanges.push(range)
      return null
    }
  }))

  const byNumber = new Map<number, ExamBankParsedQuestion>()
  for (const part of parts) {
    for (const item of part?.items ?? []) {
      if (isChartShellQuestion(item)) continue
      if (!byNumber.has(item.question_number)) byNumber.set(item.question_number, item)
    }
  }
  return {
    items: [...byNumber.values()].sort((a, b) => a.question_number - b.question_number),
    calls: [warmStats, ...parts.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => p.stats)],
    skippedRanges,
  }
}

// ── 기출문제 AI 해설 생성 ─────────────────────────────────────────────────
// 대상: 18~45번 문항
// 생성 필드: 풀이, Words & Phrases (해석은 PDF 업로드 값 보존)

export type GeneratedExplanation = {
  question_number: number
  intent: string        // 출제의도 (한 문장, ~한다. 형태)
  translation: string   // 해석 (지문 전체 한국어 번역)
  solution: string      // 풀이 (정답 근거 + 오답 포인트)
  vocabulary: string    // Words & Phrases (고2~3 수준, 지문 등장 순서)
}

export type QuestionForExplanation = {
  question_number: number
  passage: string
  question_text: string
  choices: string[]
  answer: string
  existing_vocabulary?: string
  /** 원본 해설 (있으면 부정하지 않고 통합·확장) */
  existing_explanation?: string
}

// 배치당 문항 수. 한 콜에 너무 많이 넣으면 출력이 maxTokens(16000)에 잘리고 벽시계도 그만큼 길어진다.
const EXPLANATION_BATCH_SIZE = 7
// 동시 콜 수 — Anthropic rate limit 예산과 맞바꾸는 값
const EXPLANATION_CONCURRENCY = 4

/**
 * 해설 생성 — 내부에서 EXPLANATION_BATCH_SIZE 문항씩 나눠 동시 호출한다.
 * 출력(해설 텍스트)이 병목이라 배치 병렬화로 벽시계가 줄고, 콜당 출력이 작아져 maxTokens 잘림도 사라진다.
 * 배치 하나라도 실패하면 전체 throw (기존 단일 콜 실패 의미와 동일). 결과는 입력 순서 유지.
 */
export async function generateExplanations(
  questions: QuestionForExplanation[],
  mode: 'standard' | 'full' = 'standard',
  opts: { batchSize?: number; concurrency?: number } = {},
): Promise<GeneratedExplanation[]> {
  if (questions.length === 0) return []
  const batchSize = opts.batchSize ?? EXPLANATION_BATCH_SIZE
  const concurrency = opts.concurrency ?? EXPLANATION_CONCURRENCY

  const batches: QuestionForExplanation[][] = []
  for (let i = 0; i < questions.length; i += batchSize) batches.push(questions.slice(i, i + batchSize))

  const groups = await mapWithConcurrency(batches, concurrency, (batch) => generateExplanationsBatch(batch, mode))
  return groups.flat()
}

async function generateExplanationsBatch(
  questions: QuestionForExplanation[],
  mode: 'standard' | 'full',
): Promise<GeneratedExplanation[]> {

  const solutionGuide = mode === 'full'
    ? `- 정답 근거: 지문에서 정답의 단서가 되는 핵심 문장/표현을 한국어로 짚어줄 것
   - 오답 포인트: 주요 오답 선지가 왜 틀렸는지 구체적으로 설명
   - 핵심 어구/구문: 지문의 중요 표현이나 논리 흐름을 추가 설명
   - 학생이 다음에 유사 문항을 맞힐 수 있도록 풀이 전략 중심으로 작성
   - 4~6문장으로 충분히 상세하게`
    : `- 정답 근거: 지문에서 정답의 단서가 되는 핵심 문장/표현을 한국어로 짚어줄 것
   - 오답 포인트: 헷갈리기 쉬운 오답 선지가 왜 틀렸는지 간결하게 설명 (1~2개)
   - 단순 "정답은 ~이다" 수준이 아니라, 학생이 다음에 유사 문항을 맞힐 수 있도록 풀이 전략 중심으로 작성
   - 2~4문장 이내로 간결하게`

  const prompt = `다음 수능/모의고사 영어 문항들의 해설을 생성하세요.

각 문항에 대해 아래 네 가지를 작성하세요:

1. intent (출제의도)
   - 이 문항이 측정하는 능력을 한 문장으로 서술
   - 반드시 "~한다." 형태로 끝낼 것
   - 예: "글의 목적을 추론한다."  "빈칸에 들어갈 내용을 추론한다."  "어법에 맞는 표현을 판단한다."

2. translation (해석)
   - 지문 전체를 자연스러운 한국어로 번역
   - 원문 단락 구조(줄바꿈)를 그대로 유지
   - 도표·실용문 등 번역이 불필요한 경우 ""

3. solution (풀이)
   ${solutionGuide}

4. vocabulary (Words & Phrases)
   - 지문에 등장하는 고2~고3 수준의 학습 중요 단어/숙어만 선별
   - 기존 Words & Phrases가 제공된 문항은 기존 단어/뜻을 반드시 모두 포함하고, 필요한 단어만 추가할 것
   - 등장 순서대로 나열
   - 형식: "단어 뜻" (예: "eliminate 제거하다   gradual 점진적인   be prone to ~하기 쉽다")
   - 선별 기준:
     * 포함: 수능/모의고사 빈출 어휘, 고2~3 교과 수준 단어
     * 제외: the, is, have, said 등 기초 어휘
     * 제외: obscure, ostensible 등 최상위 어휘 (고3 수준 초과)
   - 한 줄에 모두 나열 (줄바꿈 없이), 단어 사이 3칸 띄어쓰기

문항 데이터:
${questions.map((q) => `
[${q.question_number}번]
지문: ${q.passage || '(지문 없음)'}
발문: ${q.question_text}
선지: ${q.choices.join(' / ')}
정답: ${q.answer}
기존 Words & Phrases: ${q.existing_vocabulary || '(없음)'}
`).join('\n---\n')}

중요: 모든 값 안에 큰따옴표(")를 절대 사용하지 마세요. 인용이 필요하면 작은따옴표(')나 한국어 따옴표(「」)를 사용하세요.

JSON 배열만 출력 (다른 텍스트 없이):
[{"question_number": 20, "intent": "빈칸에 들어갈 내용을 추론한다.", "translation": "...", "solution": "...", "vocabulary": "word1 뜻1   word2 뜻2"}]`

  const raw = await callClaudeText({
    model: 'claude-opus-4-7',
    maxTokens: 16000,
    content: prompt,
  })
  console.log('[generateExplanations] raw length:', raw.length)

  try {
    return parseJsonArrayResponse<GeneratedExplanation>(raw, 'generateExplanations')
  } catch (e) {
    console.error('[generateExplanations] JSON parse 실패:', e)
    const cleaned = extractJsonArrayCandidate(raw)
    // 실패 위치 주변 텍스트 로깅 (디버깅용)
    const posMatch = String(e instanceof Error ? e.message : e).match(/position (\d+)/)
    if (posMatch) {
      const pos = parseInt(posMatch[1])
      console.error('[generateExplanations] 실패 위치 주변:', JSON.stringify(cleaned.slice(Math.max(0, pos - 80), pos + 80)))
    }
    // 폴백: 개별 JSON 객체 추출 시도
    const objects: GeneratedExplanation[] = []
    const objRe = /\{\s*"question_number"\s*:\s*(\d+)[^}]*\}/g
    let match: RegExpExecArray | null
    while ((match = objRe.exec(cleaned)) !== null) {
      try {
        objects.push(JSON.parse(jsonrepair(match[0])))
      } catch {
        // 개별 객체도 파싱 불가 → 스킵
      }
    }
    if (objects.length > 0) {
      console.warn(`[generateExplanations] 폴백 파싱 성공: ${objects.length}개 추출`)
      return objects
    }
    throw new Error(`JSON 파싱 실패 (${e instanceof Error ? e.message : e}). raw 길이: ${cleaned.length}`)
  }
}

// ── 해설 PDF 업로드 파싱 ──────────────────────────────────────────────────
// 두 형식(평가원형·학평형) × 두 방식(whole 통짜 1콜 / ranged 출력 범위 분할):
// ranged 는 PDF 를 자르지 않고 매 콜 통째로 보내되 "이번엔 N~M번만 출력"으로 응답을 나눈다.
// 파일+프롬프트를 프롬프트 캐싱(첫 콜 예열 → 나머지 병렬 캐시 히트)으로 재사용하므로
// 입력 비용은 통짜의 약 1.45배에 그치고, 콜당 출력이 작아져 maxTokens 잘림이 구조적으로 사라진다.

/** 출력 범위 4분할 (18~45 독해 영역). 캐시 예열 후 전 범위 병렬이므로 분할 수 = 병렬 폭 */
const EXPLANATION_RANGES: [number, number][] = [[18, 24], [25, 31], [32, 38], [39, 45]]

export type ExplanationCallStats = CallClaudeUsage & {
  stopReason: string | null
  ms: number
  range: [number, number] | null
}

export type ExplanationParseDetail = {
  items: ParsedExplanation[]
  calls: ExplanationCallStats[]
}

function rangeInstruction([start, end]: [number, number]): string {
  return `[범위 지시] 이번 호출에서는 ${start}번부터 ${end}번까지의 문항만 추출해 출력하세요. 다른 번호의 문항은 절대 출력하지 마세요.`
}

/**
 * 범위 파싱 1콜 (범용). 프롬프트 블록을 캐시 경계로 삼아(파일+프롬프트 캐시)
 * 범위 지시만 뒤에 붙인다 — 콜 간 접두부가 동일해야 캐시가 적중한다.
 * range 가 null 이면 통짜 1콜 (캐시 미사용).
 */
async function rangedParseCall<T extends { question_number: number }>(opts: {
  base64: string
  mimeType?: string
  model: string
  maxTokens: number
  prompt: string
  range: [number, number] | null
  label: string
}): Promise<{ items: T[]; stats: ExplanationCallStats }> {
  const fileBlock = buildFileBlock(opts.base64, opts.mimeType ?? 'application/pdf')
  const content: ContentBlock[] = opts.range
    ? [fileBlock, { type: 'text', text: opts.prompt, cache_control: { type: 'ephemeral' } }, { type: 'text', text: rangeInstruction(opts.range) }]
    : [fileBlock, { type: 'text', text: opts.prompt }]

  const started = Date.now()
  const { text, usage, stopReason } = await callClaudeTextDetailed({
    model: opts.model,
    maxTokens: opts.maxTokens,
    content,
  })
  const parsed = parseJsonArrayResponse<T>(text, opts.label)
    .filter((e) => e.question_number >= (opts.range?.[0] ?? 18) && e.question_number <= (opts.range?.[1] ?? 45))
  return { items: parsed, stats: { ...usage, stopReason, ms: Date.now() - started, range: opts.range } }
}

/** 캐시 예열: max_tokens 0 — 파일+프롬프트를 읽어 캐시에 올리기만 하고 출력은 없다 (실측 31p 7.6s) */
async function prewarmPdfCache(opts: {
  base64: string
  mimeType?: string
  model: string
  prompt: string
}): Promise<ExplanationCallStats> {
  const started = Date.now()
  const warm = await callClaudeTextDetailed({
    model: opts.model,
    maxTokens: 0,
    content: [
      buildFileBlock(opts.base64, opts.mimeType ?? 'application/pdf'),
      { type: 'text', text: opts.prompt, cache_control: { type: 'ephemeral' } },
    ],
  })
  return { ...warm.usage, stopReason: warm.stopReason, ms: Date.now() - started, range: null }
}

/**
 * 캐시 예열(max_tokens 0 — 파일+프롬프트를 읽어 캐시에 올리기만, 출력 없음) →
 * 전 범위 병렬 파싱. 번호 중복은 앞선 범위가 이긴다.
 * 실측(31p 모평, 3분할 예열 겸용): 예열 137s + 병렬 154s = 291s → 예열 분리로 병렬 폭만큼 단축.
 */
async function parseExplanationsRanged(
  base64: string,
  prompt: string,
  label: string,
): Promise<ExplanationParseDetail> {
  const warmStats = await prewarmPdfCache({ base64, model: 'claude-opus-4-7', prompt })

  const parts = await Promise.all(EXPLANATION_RANGES.map((range) =>
    rangedParseCall<ParsedExplanation>({ base64, model: 'claude-opus-4-7', maxTokens: 16000, prompt, range, label })))

  const byNumber = new Map<number, ParsedExplanation>()
  for (const part of parts) {
    for (const item of part.items) {
      if (!byNumber.has(item.question_number)) byNumber.set(item.question_number, item)
    }
  }
  return {
    items: [...byNumber.values()].sort((a, b) => a.question_number - b.question_number),
    calls: [warmStats, ...parts.map((part) => part.stats)],
  }
}

const SUNEUNG_EXPLANATION_PROMPT = `이 PDF는 수능/모의고사 영어 해설지입니다. 18번~45번 문항의 해설을 추출해 주세요.

각 문항은 아래 섹션으로 구성되어 있습니다 (없는 섹션은 빈 문자열):
- [출제의도] 또는 【출제의도】
- [해석] 또는 【해석】
- [풀이] 또는 【풀이】
- [Words and Phrases] 또는 [어휘] 등

장문 문항(예: 41~42번, 43~45번)은 [해석]과 [Words and Phrases]를 공유하므로 각 번호에 동일하게 넣어 주세요.

중요:
- translation([해석])은 요약·축약·의역 절대 금지 — PDF에 인쇄된 해석 문장을 처음부터 끝까지 한 문장도 빠짐없이 그대로 옮기세요.
  장문 공유 해석도 전문 전체를 각 번호에 동일하게 복사하세요. 길다고 줄이면 안 됩니다.
- solution과 vocabulary 값 안에 큰따옴표(")를 절대 사용하지 마세요. 작은따옴표(')나 한국어 따옴표(「」)를 사용하세요.
- 18번 미만(듣기 영역)은 제외하세요.

JSON 배열만 출력 (다른 텍스트 없이):
[
  {
    "question_number": 18,
    "intent": "[출제의도] 내용",
    "translation": "[해석] 내용",
    "solution": "[풀이] 내용",
    "vocabulary": "[Words and Phrases] 내용"
  },
  ...
]`

/**
 * 평가원형(수능/모평) 해설 PDF 통짜 1콜 파싱.
 * unpdf가 한국어 폰트 인코딩을 읽지 못하는 EBS PDF 등에서 fallback으로 사용.
 */
export async function parsePdfExplanationsWithClaude(
  buffer: ArrayBuffer,
): Promise<ParsedExplanation[]> {
  const base64 = Buffer.from(buffer).toString('base64')
  try {
    const { items } = await rangedParseCall<ParsedExplanation>({
      base64, model: 'claude-opus-4-7', maxTokens: 16000,
      prompt: SUNEUNG_EXPLANATION_PROMPT, range: null, label: 'parsePdfExplanationsWithClaude',
    })
    return items
  } catch (e) {
    console.error('[parsePdfExplanationsWithClaude] 실패:', e)
    throw new Error(`Claude Vision PDF 파싱 실패: ${e instanceof Error ? e.message : e}`)
  }
}

/** 평가원형 해설 PDF 출력 범위 분할 파싱 (통째 입력 + 캐싱 + 3콜) */
export async function parsePdfExplanationsWithClaudeRanged(
  buffer: ArrayBuffer,
): Promise<ExplanationParseDetail> {
  const base64 = Buffer.from(buffer).toString('base64')
  return parseExplanationsRanged(base64, SUNEUNG_EXPLANATION_PROMPT, 'parsePdfExplanationsWithClaudeRanged')
}

const HAKPYUNG_EXPLANATION_PROMPT = `이 PDF는 교육청 학력평가(학평) 영어 해설지입니다.

학평 해설지 형식:
  "N. [출제의도] 한줄설명. 한국어 번역 내용 전체..."
  (평가원과 달리 [해석]/[풀이]/[Words and Phrases] 헤더가 없음)

18번~45번 문항(독해 영역)의 출제의도와 한국어 번역을 추출하세요.
1~17번(듣기 영역)은 제외하세요.

각 필드:
- intent: [출제의도] 바로 뒤의 짧은 설명 (예: "글의 목적을 추론한다.")
- translation: 그 뒤에 오는 한국어 번역 전체 (도표·실용문 등 번역 없는 문항은 "").
  요약·축약·의역 절대 금지 — 인쇄된 번역을 처음부터 끝까지 그대로 옮길 것.
- solution: "" (빈 문자열 — AI가 별도로 생성함)
- vocabulary: 문항 끝에 "단어 뜻" 형태 어휘가 있으면 추출, 없으면 ""

중요: 값 안에 큰따옴표(")를 사용하지 마세요.

JSON 배열만 출력:
[{"question_number": 18, "intent": "...", "translation": "...", "solution": "", "vocabulary": ""}]`

/**
 * 학평(교육청 학력평가) 해설 PDF 통짜 1콜 파싱.
 * 학평 해설지는 [출제의도] + 한국어 번역만 있고, [풀이]/[어휘] 섹션이 없다.
 * 풀이와 어휘는 이후 generateExplanations(full mode)로 별도 생성.
 */
export async function parsePdfExplanationsHakpyung(
  buffer: ArrayBuffer,
): Promise<ParsedExplanation[]> {
  const base64 = Buffer.from(buffer).toString('base64')
  try {
    const { items } = await rangedParseCall<ParsedExplanation>({
      base64, model: 'claude-opus-4-7', maxTokens: 16000,
      prompt: HAKPYUNG_EXPLANATION_PROMPT, range: null, label: 'parsePdfExplanationsHakpyung',
    })
    return items
  } catch (e) {
    console.error('[parsePdfExplanationsHakpyung] 실패:', e)
    throw new Error(`학평 Vision PDF 파싱 실패: ${e instanceof Error ? e.message : e}`)
  }
}

/** 학평형 해설 PDF 출력 범위 분할 파싱 (통째 입력 + 캐싱 + 3콜) */
export async function parsePdfExplanationsHakpyungRanged(
  buffer: ArrayBuffer,
): Promise<ExplanationParseDetail> {
  const base64 = Buffer.from(buffer).toString('base64')
  return parseExplanationsRanged(base64, HAKPYUNG_EXPLANATION_PROMPT, 'parsePdfExplanationsHakpyungRanged')
}
