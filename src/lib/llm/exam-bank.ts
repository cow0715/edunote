// ── 기출문제 은행: 시험지 파싱 + 해설 생성/추출 ─────────────────────────────

import { EXAM_BANK_PARSE_RULES } from '../prompts'
import type { ParsedExplanation } from '../explanation-parser'
import { buildFileBlock, callLlmText, createLlmExecution, parseJsonArrayResponse, type TaskCallOptions } from './client'
import { prewarmPdfCache, rangedParseCallIsolated, sliceNumbers, type RangedCallStats } from './ranged'
import { EXPLANATION_WRITING_RULES } from './material-enrichment-contract'
import { getPdfWorkerContext } from '../pdf-import/context'
import { recoverExamEntries } from './exam-bank-recovery'
import type { ExamImportExclusion, ExamImportIssue } from '../pdf-import/exam-completeness'
import { needsVisualSource } from '../source-region'

export type ExamBankParsedQuestion = {
  question_number: number
  question_type: string
  passage: string
  question_text: string
  choices: string[]
  answer: string
  needs_source_image?: boolean
  source_page?: number | null
  source_bbox?: import('../source-region').SourceRegion | null
}

export async function parseExamBankPage(
  fileData: string,
  mimeType: string,
  options: TaskCallOptions = {},
): Promise<ExamBankParsedQuestion[]> {
  const fileContent = buildFileBlock(fileData, mimeType, '지원하지 않는 파일 형식 (PDF 또는 이미지만 가능)')

  const raw = await callLlmText({
    task: 'examBank.parseQuestions',
    execution: options.execution,
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
  issues?: ExamImportIssue[]
  excludedQuestions?: ExamImportExclusion[]
}

/** A chart may legitimately have no text passage. Kept for diagnostics only;
 * the parser must retain this question and attach the original PDF region. */
export function isChartShellQuestion(question: Pick<ExamBankParsedQuestion, 'passage' | 'question_text'>): boolean {
  return !(question.passage ?? '').trim() && /도표|그래프/.test(question.question_text ?? '')
}

/** 기출 문제지 파싱: 캐시 예열(출력 0) → 5범위 병렬. 실측(8p 모평): whole 256s → 입력 청킹 133s → 69s */
export async function parseExamBankPageRanged(
  fileData: string,
  mimeType: string,
  options: TaskCallOptions = {},
): Promise<ExamBankRangedResult> {
  // sonnet-5: 4-6 대비 단가 33% 낮고(2/10 vs 3/15) 신세대라 필터 거절이 stop_reason 으로 온다 (2026-08-27 전환)
  const task = 'examBank.parseQuestions' as const
  const execution = options.execution ?? createLlmExecution()
  const files = [{ fileData, mimeType }]
  const batch = !!getPdfWorkerContext()?.batchCall
  if (batch) return recoverExamEntries<ExamBankParsedQuestion>({ files, task, execution, prompt: EXAM_BANK_PARSE_RULES, maxTokens: 8192,
    numbers: EXAM_BANK_NUMBER_GROUPS.flat(), inspect: (item) => {
      const visual = needsVisualSource({ needs_source_image: item.needs_source_image === true,
        question_type: typeof item.question_type === 'string' ? item.question_type : undefined,
        question_text: typeof item.question_text === 'string' ? item.question_text : undefined })
      if (typeof item.question_text !== 'string' || !item.question_text.trim() || typeof item.passage !== 'string' || (!visual && !item.passage.trim()) ||
        typeof item.question_type !== 'string' || !item.question_type.trim() || !Array.isArray(item.choices) || item.choices.length !== 5 ||
        item.choices.some((choice) => typeof choice !== 'string' || !choice.trim())) return { reason: '지문·발문·문항 유형 또는 선지 5개가 누락됐습니다.' }
      return { item: { ...item, question_number: Number(item.question_number), answer: '' } as ExamBankParsedQuestion }
    } })
  const warmStats = await prewarmPdfCache({ files, task, execution, prompt: EXAM_BANK_PARSE_RULES })

  // 필터 격리: 그룹이 필터에 걸리면 문항 단위로 재시도 — 진짜 걸린 문항만 결손
  const requests = EXAM_BANK_NUMBER_GROUPS.map((numbers) =>
    rangedParseCallIsolated<ExamBankParsedQuestion>({
      files, task, execution, maxTokens: 8192,
      prompt: EXAM_BANK_PARSE_RULES, scope: { numbers }, label: 'parseExamBankPageRanged',
    }))
  const parts = await Promise.all(requests)

  const byNumber = new Map<number, ExamBankParsedQuestion>()
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
  issues?: ExamImportIssue[]
}

type ExplanationOptions = TaskCallOptions & { expectedNumbers?: number[] }

/** 캐시 예열(출력 0) → 전 범위 병렬. 필터가 걸린 범위는 문항 단위 격리 재시도 — 진짜 걸린 문항만 결손 */
async function parseExplanationsRanged(
  base64: string,
  prompt: string,
  label: string,
  options: ExplanationOptions,
): Promise<ExplanationParseDetail> {
  // sonnet-5(parse 역할): 문항당 1콜 전 병렬에서 캐시 읽기·출력 단가가 opus 의 40% — 시험당 ~$2.8→$1.1.
  // 해설 "작성"도 원문 풀이 기반 확장이라 부담이 작고, 주차 해설 보강과 같은 모델로 품질 기준이 일관된다.
  const task = 'examBank.extractExplanations' as const
  const execution = options.execution ?? createLlmExecution()
  const files = [{ fileData: base64, mimeType: 'application/pdf' }]
  const batch = !!getPdfWorkerContext()?.batchCall
  if (batch) return recoverExamEntries<ParsedExplanation>({ files, task, execution, prompt, maxTokens: 16000,
    numbers: options.expectedNumbers ?? EXAM_BANK_NUMBER_GROUPS.flat(), inspect: (item) => {
      if (['intent', 'translation', 'solution', 'vocabulary'].some((field) => typeof item[field] !== 'string') ||
        !(item.solution as string).trim()) return { reason: '해설 필드가 누락됐거나 풀이가 비어 있습니다.' }
      return { item: { ...item, question_number: Number(item.question_number) } as ParsedExplanation }
    } })
  const warmStats = await prewarmPdfCache({ files, task, execution, prompt })

  const requests = EXAM_BANK_NUMBER_GROUPS.map((numbers) =>
    rangedParseCallIsolated<ParsedExplanation>({ files, task, execution, maxTokens: 16000, prompt, scope: { numbers }, label }))
  const parts = await Promise.all(requests)

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
  options: ExplanationOptions = {},
): Promise<ExplanationParseDetail> {
  const base64 = Buffer.from(buffer).toString('base64')
  return parseExplanationsRanged(base64, SUNEUNG_EXPLANATION_PROMPT, 'parsePdfExplanationsWithClaudeRanged', options)
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
  options: ExplanationOptions = {},
): Promise<ExplanationParseDetail> {
  const base64 = Buffer.from(buffer).toString('base64')
  return parseExplanationsRanged(base64, HAKPYUNG_EXPLANATION_PROMPT, 'parsePdfExplanationsHakpyungRanged', options)
}
