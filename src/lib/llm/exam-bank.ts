// ── 기출문제 은행: 시험지 파싱 + 해설 생성/추출 ─────────────────────────────

import { EXAM_BANK_PARSE_RULES } from '../prompts'
import type { ParsedExplanation } from '../explanation-parser'
import { buildFileBlock, callClaudeText, MODELS, parseJsonArrayResponse } from './client'
import { prewarmPdfCache, rangedParseCallIsolated, sliceNumbers, type RangedCallStats } from './ranged'

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
    model: MODELS.parse,
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
// 매 콜 문서 전체를 보므로 장문 세트(41~45)가 그룹 경계에 갈라져도 지문은 온전하다.

/** 독해 영역 번호 (18~45) — 콜당 문항 수는 코어 공통 상수를 따른다 */
const EXAM_BANK_NUMBER_GROUPS = sliceNumbers(Array.from({ length: 28 }, (_, i) => 18 + i))

export type ExamBankRangedResult = {
  items: ExamBankParsedQuestion[]
  calls: ExplanationCallStats[]
  /** 콘텐츠 필터로 결손된 문항 번호 (문항 단위 격리 재시도 후에도 걸린 것만) */
  skippedNumbers: number[]
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
  // sonnet-5: 4-6 대비 단가 33% 낮고(2/10 vs 3/15) 신세대라 필터 거절이 stop_reason 으로 온다 (2026-08-27 전환)
  const model = MODELS.parse
  const files = [{ fileData, mimeType }]
  const warmStats = await prewarmPdfCache({ files, model, prompt: EXAM_BANK_PARSE_RULES })

  // 필터 격리: 그룹이 필터에 걸리면 문항 단위로 재시도 — 진짜 걸린 문항만 결손
  const parts = await Promise.all(EXAM_BANK_NUMBER_GROUPS.map((numbers) =>
    rangedParseCallIsolated<ExamBankParsedQuestion>({
      files, model, maxTokens: 8192,
      prompt: EXAM_BANK_PARSE_RULES, scope: { numbers }, label: 'parseExamBankPageRanged',
    })))

  const byNumber = new Map<number, ExamBankParsedQuestion>()
  for (const part of parts) {
    for (const item of part.items) {
      if (isChartShellQuestion(item)) continue
      if (!byNumber.has(item.question_number)) byNumber.set(item.question_number, item)
    }
  }
  return {
    items: [...byNumber.values()].sort((a, b) => a.question_number - b.question_number),
    calls: [warmStats, ...parts.flatMap((part) => part.calls)],
    skippedNumbers: parts.flatMap((part) => part.skippedNumbers).sort((a, b) => a - b),
  }
}

// ── 해설 PDF 업로드 파싱 (통째 입력 + 캐싱 + 범위 병렬 — 추출과 AI 보완을 한 콜에) ──
// 별도의 AI 해설 생성 단계(generate-explanation)는 삭제됨 (2026-08-27) — 프롬프트가
// 원문 해설을 기반으로 풀이·어휘까지 보완 작성한다. 해석·출제의도는 원문 그대로.


/** @deprecated 이름 유지용 별칭 — 코어의 RangedCallStats 를 그대로 쓴다 */
export type ExplanationCallStats = RangedCallStats

export type ExplanationParseDetail = {
  items: ParsedExplanation[]
  calls: ExplanationCallStats[]
  /** 콘텐츠 필터로 결손된 문항 번호 (문항 단위 격리 재시도 후에도 걸린 것만) */
  skippedNumbers: number[]
}

/** 캐시 예열(출력 0) → 전 범위 병렬. 필터가 걸린 범위는 문항 단위 격리 재시도 — 진짜 걸린 문항만 결손 */
async function parseExplanationsRanged(
  base64: string,
  prompt: string,
  label: string,
): Promise<ExplanationParseDetail> {
  // sonnet-5(parse 역할): 문항당 1콜 전 병렬에서 캐시 읽기·출력 단가가 opus 의 40% — 시험당 ~$2.8→$1.1.
  // 해설 "작성"도 원문 풀이 기반 확장이라 부담이 작고, 주차 해설 보강과 같은 모델로 품질 기준이 일관된다.
  const model = MODELS.parse
  const files = [{ fileData: base64, mimeType: 'application/pdf' }]
  const warmStats = await prewarmPdfCache({ files, model, prompt })

  const parts = await Promise.all(EXAM_BANK_NUMBER_GROUPS.map((numbers) =>
    rangedParseCallIsolated<ParsedExplanation>({ files, model, maxTokens: 16000, prompt, scope: { numbers }, label })))

  const byNumber = new Map<number, ParsedExplanation>()
  for (const part of parts) {
    for (const item of part.items) {
      if (!byNumber.has(item.question_number)) byNumber.set(item.question_number, item)
    }
  }
  return {
    items: [...byNumber.values()].sort((a, b) => a.question_number - b.question_number),
    calls: [warmStats, ...parts.flatMap((part) => part.calls)],
    skippedNumbers: parts.flatMap((part) => part.skippedNumbers).sort((a, b) => a - b),
  }
}

/** 풀이·어휘 작성 규칙 — 두 형식 프롬프트가 공유 (추출과 생성을 한 콜에 통합, 2026-08-27) */
const EXPLANATION_WRITING_RULES = `━━━ solution (풀이) 작성 규칙 ━━━
- 정답 근거: 지문에서 정답의 단서가 되는 핵심 문장/표현을 한국어로 짚어줄 것
- 오답 포인트: 주요 오답 선지가 왜 틀렸는지 구체적으로 설명
- 핵심 어구/구문: 지문의 중요 표현이나 논리 흐름을 추가 설명
- 학생이 다음에 유사 문항을 맞힐 수 있도록 풀이 전략 중심으로, 4~6문장으로 충분히 상세하게

━━━ vocabulary (Words & Phrases) 작성 규칙 ━━━
- 지문에 등장하는 고2~고3 수준의 학습 중요 단어/숙어만 선별, 등장 순서대로
- 형식: "단어 뜻" — 한 줄에 모두 나열 (줄바꿈 없이), 단어 사이 3칸 띄어쓰기
  (예: "eliminate 제거하다   gradual 점진적인   be prone to ~하기 쉽다")
- 포함: 수능/모의고사 빈출 어휘, 고2~3 교과 수준 단어
- 제외: the, is, have 등 기초 어휘 / obscure, ostensible 등 최상위 어휘 (고3 수준 초과)`

const SUNEUNG_EXPLANATION_PROMPT = `이 PDF는 수능/모의고사 영어 해설지입니다.
18번~45번 문항의 해설을 추출하고, 풀이와 어휘는 원문을 기반으로 보완해 주세요.

각 문항은 아래 섹션으로 구성되어 있습니다 (없는 섹션은 빈 문자열):
- [출제의도] 또는 【출제의도】
- [해석] 또는 【해석】
- [풀이] 또는 【풀이】
- [Words and Phrases] 또는 [어휘] 등

장문 문항(예: 41~42번, 43~45번)은 [해석]과 [Words and Phrases]를 공유하므로 각 번호에 동일하게 넣어 주세요.

필드별 규칙 — 추출(원문 그대로)과 작성(보완)이 다르니 반드시 구분하세요:
- intent: 원문 [출제의도] 그대로 추출. 창작 금지.
- translation: 원문 [해석] 그대로 추출 — 요약·축약·의역 절대 금지, PDF에 인쇄된 해석 문장을
  처음부터 끝까지 한 문장도 빠짐없이 그대로 옮기세요. 장문 공유 해석도 전문 전체를 각 번호에
  동일하게 복사하세요. 길다고 줄이면 안 됩니다. 이 필드에서만큼은 당신의 문장을 쓰지 마세요.
- solution: 원문 [풀이]를 기반으로 하되, 아래 작성 규칙에 따라 통합·확장해서 작성하세요.
- vocabulary: 원문 [Words and Phrases]의 단어/뜻을 반드시 모두 포함하고, 아래 작성 규칙에 따라
  지문의 중요 어휘를 추가 선별하세요.

${EXPLANATION_WRITING_RULES}

중요:
- 모든 값 안에 큰따옴표(")를 절대 사용하지 마세요. 작은따옴표(')나 한국어 따옴표(「」)를 사용하세요.
- 18번 미만(듣기 영역)은 제외하세요.

JSON 배열만 출력 (다른 텍스트 없이):
[
  {
    "question_number": 18,
    "intent": "[출제의도] 내용",
    "translation": "[해석] 원문 전체",
    "solution": "원문 풀이 기반 통합·확장 풀이",
    "vocabulary": "word1 뜻1   word2 뜻2"
  },
  ...
]`

// 평가원형 통짜 1콜 파서는 삭제됨 — 31p 모평에서 maxTokens 잘림으로 전체 실패가 실측돼
// (2026-08-26) 범위 분할이 전면 대체했다. 학평형 통짜는 라우트가 아직 써서 유지.

/** 평가원형 해설 PDF 출력 범위 분할 파싱 (통째 입력 + 캐싱 + 범위 병렬) */
export async function parsePdfExplanationsWithClaudeRanged(
  buffer: ArrayBuffer,
): Promise<ExplanationParseDetail> {
  const base64 = Buffer.from(buffer).toString('base64')
  return parseExplanationsRanged(base64, SUNEUNG_EXPLANATION_PROMPT, 'parsePdfExplanationsWithClaudeRanged')
}

const HAKPYUNG_EXPLANATION_PROMPT = `이 PDF는 교육청 학력평가(학평) 영어 해설지입니다.
18번~45번 문항(독해 영역)의 출제의도·번역을 추출하고, 원문에 없는 풀이·어휘는 직접 작성해 주세요.
1~17번(듣기 영역)은 제외하세요.

학평 해설지 형식:
  "N. [출제의도] 한줄설명. 한국어 번역 내용 전체..."
  (평가원과 달리 [해석]/[풀이]/[Words and Phrases] 헤더가 없음)

필드별 규칙 — 추출(원문 그대로)과 작성(신규)이 다르니 반드시 구분하세요:
- intent: [출제의도] 바로 뒤의 짧은 설명 그대로 추출 (예: "글의 목적을 추론한다."). 창작 금지.
- translation: 그 뒤에 오는 한국어 번역 전체 그대로 추출 (도표·실용문 등 번역 없는 문항은 "").
  요약·축약·의역 절대 금지 — 인쇄된 번역을 처음부터 끝까지 그대로 옮길 것.
  이 필드에서만큼은 당신의 문장을 쓰지 마세요.
- solution: 원문에 풀이가 없으므로 지문·선지·정답을 근거로 아래 작성 규칙에 따라 직접 작성하세요.
- vocabulary: 문항 끝에 "단어 뜻" 어휘가 있으면 모두 포함하고, 아래 작성 규칙에 따라
  지문의 중요 어휘를 추가 선별하세요.

${EXPLANATION_WRITING_RULES}

중요: 값 안에 큰따옴표(")를 사용하지 마세요.

JSON 배열만 출력:
[{"question_number": 18, "intent": "...", "translation": "원문 번역 전체", "solution": "직접 작성한 풀이", "vocabulary": "word1 뜻1   word2 뜻2"}]`

/** 학평형 해설 PDF 출력 범위 분할 파싱 (통째 입력 + 캐싱 + 범위 병렬) */
export async function parsePdfExplanationsHakpyungRanged(
  buffer: ArrayBuffer,
): Promise<ExplanationParseDetail> {
  const base64 = Buffer.from(buffer).toString('base64')
  return parseExplanationsRanged(base64, HAKPYUNG_EXPLANATION_PROMPT, 'parsePdfExplanationsHakpyungRanged')
}
