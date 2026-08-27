/**
 * 출력 범위 분할 파싱 코어 (도메인 공용 — 기출은행·진단평가가 함께 쓴다).
 *
 * PDF 를 자르지 않고 매 콜 통째로 보내되 "이번엔 이 번호들만 출력"으로 응답을 나눈다.
 * 파일+프롬프트 접두부를 프롬프트 캐싱으로 재사용(예열 1콜 1.25배 → 이후 콜 0.1배)하므로
 * 입력 비용은 통짜의 ~1.5배에 그치고, 콜당 출력이 작아져 maxTokens 잘림이 구조적으로 사라진다.
 * 콜 간 접두부(파일 블록 + 프롬프트 블록)가 바이트 동일해야 캐시가 적중한다 — 달라지는
 * 지시(범위·번호 조사)는 반드시 캐시 경계 뒤의 별도 블록으로 붙인다.
 *
 * 번호를 미리 아는 도메인(기출 18~45)은 range, 모르는 도메인(진단평가)은
 * discoverQuestionNumbers 로 번호를 발견한 뒤 numbers 스코프를 쓴다.
 */

import { buildFileBlock, callClaudeTextDetailed, parseJsonArrayResponse, type CallClaudeUsage, type ContentBlock } from './client'
import { coerceQuestionNumber } from './postprocess'

export type RangedCallStats = CallClaudeUsage & {
  stopReason: string | null
  ms: number
  /** 이 콜이 맡은 번호 구간 (예열·통짜는 null). numbers 스코프는 [min, max] 로 기록 */
  range: [number, number] | null
}

/** 출력 범위: 연속 구간(range) 또는 명시 번호 목록(numbers) */
export type RangedScope = { range: [number, number] } | { numbers: number[] }

/** 첨부 파일 1개 — PDF 1개일 수도, 낱장 사진 여러 장 중 하나일 수도 있다 */
export type RangedFile = { fileData: string; mimeType: string }

function buildFileBlocks(files: RangedFile[]): ContentBlock[] {
  if (!files.length) throw new Error('첨부 파일이 없습니다.')
  return files.map((file) => buildFileBlock(file.fileData, file.mimeType))
}

function scopeInstruction(scope: RangedScope): string {
  if ('range' in scope) {
    return `[범위 지시] 이번 호출에서는 ${scope.range[0]}번부터 ${scope.range[1]}번까지의 문항만 추출해 출력하세요. 다른 번호의 문항은 절대 출력하지 마세요.`
  }
  return `[범위 지시] 이번 호출에서는 다음 번호의 문항만 추출해 출력하세요: ${scope.numbers.join(', ')}번. 다른 번호의 문항은 절대 출력하지 마세요.`
}

function scopeBounds(scope: RangedScope): [number, number] {
  if ('range' in scope) return scope.range
  return [Math.min(...scope.numbers), Math.max(...scope.numbers)]
}

/** 스코프 밖 번호 응답 제거 (모델이 범위 지시를 어긴 경우의 안전망). 번호 없는 항목도 버린다 */
export function filterByScope<T extends { question_number: unknown }>(items: T[], scope: RangedScope): T[] {
  const allowed = 'numbers' in scope ? new Set(scope.numbers) : null
  const [start, end] = scopeBounds(scope)
  return items.filter((item) => {
    const n = coerceQuestionNumber(item.question_number)
    if (!n) return false
    return allowed ? allowed.has(n) : n >= start && n <= end
  })
}

/**
 * 범위 파싱 1콜. scope 가 있으면 프롬프트 블록을 캐시 경계로 삼고 범위 지시만 뒤에 붙인다.
 * scope 가 null 이면 통짜 1콜 (캐시 미사용) — 범위 분할 이전 경로의 하위호환.
 */
export async function rangedParseCall<T extends { question_number: unknown }>(opts: {
  files: RangedFile[]
  model: string
  maxTokens: number
  prompt: string
  scope: RangedScope | null
  label: string
}): Promise<{ items: T[]; stats: RangedCallStats }> {
  const fileBlocks = buildFileBlocks(opts.files)
  const content: ContentBlock[] = opts.scope
    ? [...fileBlocks, { type: 'text', text: opts.prompt, cache_control: { type: 'ephemeral' } }, { type: 'text', text: scopeInstruction(opts.scope) }]
    : [...fileBlocks, { type: 'text', text: opts.prompt }]

  const started = Date.now()
  const { text, usage, stopReason } = await callClaudeTextDetailed({
    model: opts.model,
    maxTokens: opts.maxTokens,
    content,
  })
  const parsed = parseJsonArrayResponse<T>(text, opts.label)
  return {
    items: opts.scope ? filterByScope(parsed, opts.scope) : parsed,
    stats: { ...usage, stopReason, ms: Date.now() - started, range: opts.scope ? scopeBounds(opts.scope) : null },
  }
}

/** 캐시 예열: max_tokens 0 — 파일+프롬프트를 읽어 캐시에 올리기만 하고 출력은 없다 (실측 31p 7.6s) */
export async function prewarmPdfCache(opts: {
  files: RangedFile[]
  model: string
  prompt: string
}): Promise<RangedCallStats> {
  const started = Date.now()
  const warm = await callClaudeTextDetailed({
    model: opts.model,
    maxTokens: 0,
    content: [
      ...buildFileBlocks(opts.files),
      { type: 'text', text: opts.prompt, cache_control: { type: 'ephemeral' } },
    ],
  })
  return { ...warm.usage, stopReason: warm.stopReason, ms: Date.now() - started, range: null }
}

/**
 * 예열 겸 번호 발견: 파싱 대신 문서의 주 문항 번호 목록만 출력받는다 (출력 ~수십 토큰).
 * 번호를 미리 모르는 문서(진단평가 등)에서 범위 분할의 선행 단계 — 캐시 생성을 겸하므로
 * 별도 예열 콜이 필요 없다.
 */
export async function discoverQuestionNumbers(opts: {
  files: RangedFile[]
  model: string
  prompt: string
  label: string
}): Promise<{ numbers: number[]; stats: RangedCallStats }> {
  const started = Date.now()
  const { text, usage, stopReason } = await callClaudeTextDetailed({
    model: opts.model,
    maxTokens: 1000,
    content: [
      ...buildFileBlocks(opts.files),
      { type: 'text', text: opts.prompt, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: '[번호 조사] 이번 호출에서는 문항을 파싱하지 말고, 첨부된 자료 전체에 등장하는 모든 문항의 주 번호만 오름차순 JSON 배열로 출력하세요. 소문항 기호(a, b 등)는 무시하고 주 번호만 포함합니다. 예: [1,2,3,4,5]. 다른 텍스트 없이 배열만 출력하세요.',
      },
    ],
  })
  const numbers = [...new Set(
    parseJsonArrayResponse<unknown>(text, opts.label)
      .map((value) => coerceQuestionNumber(value))
      .filter((n): n is number => n !== null && n > 0),
  )].sort((a, b) => a - b)
  return { numbers, stats: { ...usage, stopReason, ms: Date.now() - started, range: null } }
}

/**
 * 정렬된 번호 목록을 콜당 목표 개수로 연속 슬라이스 (병렬 폭 = 슬라이스 수).
 * 나머지는 앞쪽 그룹부터 1개씩 흡수해 그룹 크기 편차를 1 이내로 유지한다.
 */
export function sliceNumbers(numbers: number[], perCall = 6): number[][] {
  if (!numbers.length) return []
  const groupCount = Math.ceil(numbers.length / perCall)
  const baseSize = Math.floor(numbers.length / groupCount)
  const remainder = numbers.length % groupCount
  const groups: number[][] = []
  let cursor = 0
  for (let i = 0; i < groupCount; i += 1) {
    const size = baseSize + (i < remainder ? 1 : 0)
    groups.push(numbers.slice(cursor, cursor + size))
    cursor += size
  }
  return groups
}
