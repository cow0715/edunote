import type { LlmTask } from '../llm/tasks'
import type { PdfImportJob, PdfImportKind } from './types'

export const PDF_BATCH_REQUEST_ATTEMPTS = 3
export const PDF_BATCH_POLL_SECONDS = 300
export const PDF_BATCH_MAX_BYTES = 32 * 1024 * 1024
export const PDF_BATCH_MODE = 'batch-v1'

export class PdfBatchPending extends Error {
  constructor() { super('PDF 배치 결과 대기') }
}
export class PdfBatchRequestFailed extends Error {}
/** An uncertain submission must never be automatically submitted and billed again. */
export class PdfBatchStopped extends Error {}

export function isPdfBatchKind(kind: PdfImportKind) {
  return ['bank_book', 'bank_questions', 'bank_explanation'].includes(kind)
}

export function isPdfBatchJob(job: Pick<PdfImportJob, 'kind' | 'payload'>) {
  if (job.kind === 'bank_book') return job.payload?.bookProcessing === PDF_BATCH_MODE
  return isPdfBatchKind(job.kind) && job.payload?.batchProcessing === PDF_BATCH_MODE
}

export function allowsPdfBatchTask(kind: PdfImportKind, task: LlmTask) {
  if (kind === 'bank_book') return task.startsWith('book.')
  if (kind === 'bank_questions' && task === 'examBank.parseQuestions') return true
  return ['bank_questions', 'bank_explanation'].includes(kind)
    && ['examBank.extractExplanations', 'vocab.enrich'].includes(task)
}

export function isPdfBatchTask(task: LlmTask) {
  return task.startsWith('book.') || ['examBank.parseQuestions', 'examBank.extractExplanations', 'vocab.enrich'].includes(task)
}

export function retryableBatchResult(type: string) {
  return ['expired', 'api_error', 'overloaded_error', 'rate_limit_error', 'timeout_error'].includes(type)
}

/** Drain all requests before suspending: Promise.all would release the worker while
 * queued calls are still collecting. A terminal failure takes priority over waiting. */
export async function settlePdfBatchCalls<T>(calls: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(calls)
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  const terminal = failures.find((r) => !(r.reason instanceof PdfBatchPending))
  if (terminal) throw terminal.reason
  if (failures.length) throw new PdfBatchPending()
  return results.map((r) => (r as PromiseFulfilledResult<T>).value)
}
