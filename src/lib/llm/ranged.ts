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

import { buildFileBlock, callClaudeTextDetailed, isContentFilterError, parseJsonArrayResponse, type CallClaudeUsage, type ContentBlock } from './client'
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

function scopeToNumbers(scope: RangedScope): number[] {
  if ('numbers' in scope) return scope.numbers
  const [start, end] = scope.range
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

/**
 * 필터 격리 범위 콜: 범위 콜이 콘텐츠 필터로 거절되면 문항 단위 콜로 쪼개 재시도한다.
 * 필터는 출력 기준이라 같은 범위의 무해한 문항은 살아남는다 — 진짜 걸린 문항만 결손으로 남는다.
 * 문항 단위 재시도는 캐시 히트(입력 0.1배)라 비용이 미미하고, 필터 이벤트에서만 발동한다.
 * 필터가 아닌 에러는 그대로 throw.
 */
export async function rangedParseCallIsolated<T extends { question_number: unknown }>(opts: {
  files: RangedFile[]
  model: string
  maxTokens: number
  prompt: string
  scope: RangedScope
  label: string
}): Promise<{ items: T[]; calls: RangedCallStats[]; skippedNumbers: number[] }> {
  try {
    const { items, stats } = await rangedParseCall<T>(opts)
    return { items, calls: [stats], skippedNumbers: [] }
  } catch (error) {
    if (!isContentFilterError(error)) throw error
    const numbers = scopeToNumbers(opts.scope)
    // 이미 1문항 콜이면 재시도해도 같은 출력 요구 — 즉시 결손 처리
    if (numbers.length <= 1) {
      console.warn(`[${opts.label}] ${numbers[0]}번 필터 skip:`, error instanceof Error ? error.message : error)
      return { items: [], calls: [], skippedNumbers: numbers }
    }
    console.warn(`[${opts.label}] ${numbers[0]}~${numbers[numbers.length - 1]}번 범위 필터 거절 → 문항 단위 격리 재시도`)

    const skippedNumbers: number[] = []
    const parts = await Promise.all(numbers.map(async (n) => {
      try {
        return await rangedParseCall<T>({ ...opts, scope: { numbers: [n] } })
      } catch (single) {
        if (!isContentFilterError(single)) throw single
        console.warn(`[${opts.label}] ${n}번 필터 skip:`, single instanceof Error ? single.message : single)
        skippedNumbers.push(n)
        return null
      }
    }))
    return {
      items: parts.flatMap((part) => part?.items ?? []),
      calls: parts.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => p.stats),
      skippedNumbers,
    }
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
 * 범위 콜당 목표 문항 수 (전 파이프라인 공통) — 분할 수 = 병렬 폭.
 * 매 콜이 캐시된 문서 전체를 보므로 잘게 쪼개도 컨텍스트 손실이 없고, 추가 비용은 콜당
 * 캐시 읽기 0.1배 뿐이다. 1 = 문항당 1콜(최대 병렬): 기출 28병렬·주차 ~20병렬 —
 * 단일 사용자·단일 작업 전제라 rate limit(ITPM 10M/분) 대비 한 자릿수 % 수준이다.
 * 콜당 출력이 최소라 잘림·벽시계도 최소가 되고, 필터 결손도 정확히 그 문항 하나로 격리된다.
 */
export const NUMBERS_PER_RANGE_CALL = 1

/**
 * 정렬된 번호 목록을 콜당 목표 개수로 연속 슬라이스 (병렬 폭 = 슬라이스 수).
 * 나머지는 앞쪽 그룹부터 1개씩 흡수해 그룹 크기 편차를 1 이내로 유지한다.
 */
export function sliceNumbers(numbers: number[], perCall = NUMBERS_PER_RANGE_CALL): number[][] {
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
