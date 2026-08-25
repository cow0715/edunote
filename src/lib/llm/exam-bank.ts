// ── 기출문제 은행: 시험지 파싱 + 해설 생성/추출 ─────────────────────────────

import { jsonrepair } from 'jsonrepair'
import { mapWithConcurrency } from '../concurrency'
import { EXAM_BANK_PARSE_RULES } from '../prompts'
import type { ParsedExplanation } from '../explanation-parser'
import { buildFileBlock, callClaudeText, extractJsonArrayCandidate, parseJsonArrayResponse } from './client'

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

/**
 * Claude Vision API로 해설 PDF를 직접 파싱한다.
 * unpdf가 한국어 폰트 인코딩을 읽지 못하는 EBS PDF 등에서 fallback으로 사용.
 */
export async function parsePdfExplanationsWithClaude(
  buffer: ArrayBuffer,
): Promise<ParsedExplanation[]> {
  const base64 = Buffer.from(buffer).toString('base64')

  const prompt = `이 PDF는 수능/모의고사 영어 해설지입니다. 18번~45번 문항의 해설을 추출해 주세요.

각 문항은 아래 섹션으로 구성되어 있습니다 (없는 섹션은 빈 문자열):
- [출제의도] 또는 【출제의도】
- [해석] 또는 【해석】
- [풀이] 또는 【풀이】
- [Words and Phrases] 또는 [어휘] 등

장문 문항(예: 41~42번, 43~45번)은 [해석]과 [Words and Phrases]를 공유하므로 각 번호에 동일하게 넣어 주세요.

중요:
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

  const raw = await callClaudeText({
    model: 'claude-opus-4-7',
    maxTokens: 16000,
    content: [buildFileBlock(base64, 'application/pdf'), { type: 'text', text: prompt }],
  })
  console.log('[parsePdfExplanationsWithClaude] raw length:', raw.length)

  try {
    const parsed = parseJsonArrayResponse<ParsedExplanation>(raw, 'parsePdfExplanationsWithClaude')
    return parsed.filter((e) => e.question_number >= 18)
  } catch (e) {
    console.error('[parsePdfExplanationsWithClaude] JSON parse 실패:', e)
    throw new Error(`Claude Vision PDF 파싱 실패: ${e instanceof Error ? e.message : e}`)
  }
}

/**
 * 학평(교육청 학력평가) 해설 PDF를 Claude Vision으로 파싱한다.
 * 학평 해설지는 [출제의도] + 한국어 번역만 있고, [풀이]/[어휘] 섹션이 없다.
 * 풀이와 어휘는 이후 generateExplanations(full mode)로 별도 생성.
 */
export async function parsePdfExplanationsHakpyung(
  buffer: ArrayBuffer,
): Promise<ParsedExplanation[]> {
  const base64 = Buffer.from(buffer).toString('base64')

  const prompt = `이 PDF는 교육청 학력평가(학평) 영어 해설지입니다.

학평 해설지 형식:
  "N. [출제의도] 한줄설명. 한국어 번역 내용 전체..."
  (평가원과 달리 [해석]/[풀이]/[Words and Phrases] 헤더가 없음)

18번~45번 문항(독해 영역)의 출제의도와 한국어 번역을 추출하세요.
1~17번(듣기 영역)은 제외하세요.

각 필드:
- intent: [출제의도] 바로 뒤의 짧은 설명 (예: "글의 목적을 추론한다.")
- translation: 그 뒤에 오는 한국어 번역 전체 (도표·실용문 등 번역 없는 문항은 "")
- solution: "" (빈 문자열 — AI가 별도로 생성함)
- vocabulary: 문항 끝에 "단어 뜻" 형태 어휘가 있으면 추출, 없으면 ""

중요: 값 안에 큰따옴표(")를 사용하지 마세요.

JSON 배열만 출력:
[{"question_number": 18, "intent": "...", "translation": "...", "solution": "", "vocabulary": ""}]`

  const raw = await callClaudeText({
    model: 'claude-opus-4-7',
    maxTokens: 16000,
    content: [buildFileBlock(base64, 'application/pdf'), { type: 'text', text: prompt }],
  })
  console.log('[parsePdfExplanationsHakpyung] raw length:', raw.length)

  try {
    const parsed = parseJsonArrayResponse<ParsedExplanation>(raw, 'parsePdfExplanationsHakpyung')
    return parsed.filter((e) => e.question_number >= 18)
  } catch (e) {
    console.error('[parsePdfExplanationsHakpyung] JSON parse 실패:', e)
    throw new Error(`학평 Vision PDF 파싱 실패: ${e instanceof Error ? e.message : e}`)
  }
}
