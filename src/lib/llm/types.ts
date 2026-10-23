import type { LlmTask } from './tasks'

export type LlmProvider = 'anthropic'
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
export type FileBlock =
  | { type: 'image'; data: string; mimeType: ImageMimeType }
  | { type: 'pdf'; data: string; mimeType: 'application/pdf' }
export type ContentBlock = FileBlock | { type: 'text'; text: string }

export type LlmUsage = {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

export type LlmFinishReason = 'complete' | 'length' | 'refusal' | 'other'
export type LlmErrorKind = 'configuration' | 'unsupported' | 'input_limit' | 'authentication' | 'rate_limit' | 'network' | 'timeout' | 'cancelled' | 'refusal' | 'provider'

export type LlmCallMetadata = {
  executionId: string
  task: LlmTask
  provider: LlmProvider
  requestedModel: string
  responseModel: string | null
  configVersion: string
  durationMs: number
  phase: 'generate' | 'prewarm'
  promptHash: string
  promptVersion: string
  schemaVersion: string
  /** The SDK handles retries internally; its actual retry count is not exposed. */
  sdkRetryCount: number | null
  transport?: 'batch'
  batchId?: string
  callKey?: string
}

export type LlmCallRecord = LlmCallMetadata & {
  usage: LlmUsage | null
  stopReason: string | null
  finishReason: LlmFinishReason | null
  errorKind: LlmErrorKind | null
}

/** Routing is immutable. Only the private-to-this-run call collection grows. */
export type LlmExecution = {
  readonly id: string
  readonly configVersion: string
  readonly taskBindings: Readonly<Record<LlmTask, string>>
  readonly calls: LlmCallRecord[]
}

export type TaskCallOptions = { execution?: LlmExecution }
export type CallLlmOptions = TaskCallOptions & {
  task: LlmTask
  maxTokens: number
  content: string | ContentBlock[]
  temperature?: number
  stream?: boolean
  /** Zero-based content-block index ending the reusable prefix. */
  cacheBoundary?: number
  phase?: 'generate' | 'prewarm'
  signal?: AbortSignal
  /** Internal Batch budget shared by content repairs and transport retries. Never sent to the model. */
  batchRetryGroup?: string
}

export type LlmDetailedResult = {
  text: string
  usage: LlmUsage
  /** Kept for existing domain truncation checks during migration. */
  stopReason: string | null
  finishReason: LlmFinishReason
  execution: LlmCallMetadata
}

export type ProviderResult = Omit<LlmDetailedResult, 'execution'> & { responseModel: string | null }
