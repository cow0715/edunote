import { createHash } from 'node:crypto'
import { claudeTokenCost } from '../costs/estimate'
import { PdfBatchStopped } from './batch-policy'

export { BOOK_FILE_BUDGET_USD, BOOK_BATCH_WINDOW } from './cost-limits'
export type BookCostSummary = { allowed: boolean; reason: string | null; limit_usd: number; spent_usd: number; reserved_usd: number; next_usd?: number; call_limit?: number; calls_used?: number; bundle_limit_usd?: number; bundle_spent_usd?: number; bundle_reserved_usd?: number }
const reasons: Record<string,string> = {
  file_call_limit: '파일 누적 AI 호출 상한 도달',
  bundle_budget_exceeded: '교재 묶음 총예산 초과', pilot_budget_exceeded: '대표 구간 예산 $0.50 초과',
  profile_preflight_required: '파일 전체 사전 구조 검사 필요', profile_held: '형식별 검사·비용 예측 보류', bundle_held: '묶음 공통 오류·버전 변경으로 새 요청 중지',
  file_budget_exceeded: '파일 총예산을 초과하는 요청', quality_failure_rate: '검사한 지문의 실패율 30% 이상',
  quality_repair_rate: '검사한 지문의 복구 요청 비율 40% 이상', protocol_changed: '처리 중 파싱 버전 변경',
  legacy_review_required: '기존 지출·응답의 확인이 필요한 작업', unknown_usage_cost: '단가 또는 사용량 확인 필요', reservation_overrun: '실제 사용량이 예약 비용을 초과함',
}
export class PdfCostStopped extends PdfBatchStopped {
  constructor(readonly summary: BookCostSummary) {
    super(`교재 자동 처리 중지: ${reasons[summary.reason ?? ''] ?? '비용 검사 실패'} (상한 $${Number(summary.limit_usd).toFixed(2)}, 사용 $${Number(summary.spent_usd).toFixed(2)}, 예약 $${Number(summary.reserved_usd).toFixed(2)}${summary.next_usd !== undefined ? `, 다음 접수 최대 $${Number(summary.next_usd).toFixed(2)}` : ''}${summary.bundle_limit_usd !== undefined ? `; 묶음 상한 $${Number(summary.bundle_limit_usd).toFixed(2)}, 사용 $${Number(summary.bundle_spent_usd ?? 0).toFixed(2)}, 예약 $${Number(summary.bundle_reserved_usd ?? 0).toFixed(2)}` : ''}). 기존 응답은 보존합니다.`)
  }
}
/** Token counting is an estimate. Reserve an input margin and the full output
 * ceiling, rather than pricing the average output and allowing a large batch. */
export function batchCostReservation(model: string, inputTokens: number, maxOutputTokens: number) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new PdfBatchStopped('토큰 계산 결과가 없어 배치를 접수하지 않습니다.')
  const inputLimit = Math.ceil(inputTokens * 1.1) + 256
  const usd = claudeTokenCost(model, { input: inputLimit, output: maxOutputTokens, read: 0, write: 0 }, { tier: 'batch' })
  if (usd === null) throw new PdfBatchStopped('검증된 Batch 단가가 없는 모델이므로 접수를 중지했습니다.')
  return { inputLimit, maxOutputTokens, reservedUsd: Math.ceil(usd * 1e6) / 1e6 }
}
export function bookCostProtocol(prompts: readonly string[], configVersion: string) {
  return createHash('sha256').update(JSON.stringify({ version: 1, prompts, configVersion, source: 'layout-compatible-v1', render: 'poppler-2000' })).digest('hex')
}
