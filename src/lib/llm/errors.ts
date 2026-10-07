import type { LlmCallMetadata, LlmErrorKind, LlmUsage } from './types'

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  readonly usage: LlmUsage | null
  readonly execution: LlmCallMetadata | null
  readonly cause: unknown
  constructor(kind: LlmErrorKind, message: string, details: { usage?: LlmUsage | null; execution?: LlmCallMetadata | null; cause?: unknown } = {}) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
    this.usage = details.usage ?? null
    this.execution = details.execution ?? null
    this.cause = details.cause
  }
}

/** Preserve historical provider error recognition while domains migrate to typed errors. */
export function isContentFilterError(error: unknown): boolean {
  if (error instanceof LlmError) return error.kind === 'refusal'
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Output blocked') || message.includes('content filtering')
}
