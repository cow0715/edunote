/** Bounds survive Cloud Run restarts; quality repair retains its own domain budgets. */
export const BOOK_BATCH_REQUEST_ATTEMPTS = 3
export const BOOK_BATCH_POLL_SECONDS = 300
export const BOOK_BATCH_MAX_BYTES = 32 * 1024 * 1024
export const BOOK_BATCH_MODE = 'batch-v1'

export class BookBatchPending extends Error {
  constructor() { super('교재 배치 결과 대기') }
}
export class BookBatchRequestFailed extends Error {}
/** An uncertain submission must never be automatically submitted and billed again. */
export class BookBatchStopped extends Error {}

export function retryableBatchResult(type: string) {
  return ['expired', 'api_error', 'overloaded_error', 'rate_limit_error', 'timeout_error'].includes(type)
}
