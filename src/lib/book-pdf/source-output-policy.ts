import type { LlmDetailedResult } from '../llm/types'

/** A bounded replacement for legacy adaptive-thinking requests. Successful old
 * evidence is still read first. Only previously missing/truncated work uses this
 * identity; restarts reuse its exact delivery, including another truncation. */
export const SOURCE_OUTPUT_POLICY = 'sonnet55-between-tools-high-v1'

export class SourceOutputIncompleteError extends Error {
  constructor(kind: 'audit' | 'repair', maxTokens: number, result: LlmDetailedResult) {
    const stage = kind === 'audit' ? '원본 대조' : '원본 부분 복구'
    super(result.stopReason === 'max_tokens' || result.finishReason === 'length'
      ? `${stage} 응답이 ${maxTokens.toLocaleString('en-US')}토큰 상한에서 잘려 검증을 완료하지 못했습니다. 잘린 응답은 보존하며 자동 증액·재요청하지 않습니다.`
      : `${stage} 응답이 완료되지 않았습니다 (${result.stopReason ?? 'unknown'}). 검증 미완료로 보류합니다.`)
    this.name = 'SourceOutputIncompleteError'
  }
}
