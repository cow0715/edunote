import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { CallLlmOptions, LlmDetailedResult } from '../llm/types'

/** A worker-scoped checkpoint store. Normal web requests never acquire this context. */
export type PdfWorkerContext = {
  /** Recovery may consume stored responses but must never create paid work. */
  cacheOnly?: boolean
  unitKey?: string
  quality?: (unit: string, status: 'mapped' | 'repair' | 'failed' | 'passed') => Promise<void>
  canPrepareUnit?: (unit: string) => boolean
  signal: AbortSignal
  concurrency: number
  execute: <T>(call: () => Promise<T>) => Promise<T>
  read: <T>(key: string) => Promise<T | null>
  write: (key: string, value: unknown) => Promise<void>
  stage: (message: string) => Promise<void>
  batchCall?: (options: CallLlmOptions, key: string) => Promise<LlmDetailedResult>
}
const storage = new AsyncLocalStorage<PdfWorkerContext>()

export function withPdfWorkerContext<T>(context: PdfWorkerContext, work: () => Promise<T>) {
  return storage.run(context, work)
}

export function getPdfWorkerContext() { return storage.getStore() }
export function withPdfUnit<T>(unitKey: string, work: () => Promise<T>) {
  const context = storage.getStore()
  return context ? storage.run({ ...context, unitKey }, work) : work()
}

export function createCallLimiter(concurrency: number): PdfWorkerContext['execute'] {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('동시 호출 수는 양의 정수여야 합니다.')
  let active = 0
  const queue: Array<() => void> = []
  return async <T>(call: () => Promise<T>) => {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve))
    else active++
    try { return await call() } finally {
      const next = queue.shift()
      if (next) next()
      else active--
    }
  }
}

export async function checkpointCall<T>(input: unknown, call: () => Promise<T>, cacheable: (result: T) => boolean = () => true): Promise<T> {
  const context = storage.getStore()
  if (!context) return call()
  context.signal.throwIfAborted()
  const key = checkpointKey(input)
  const saved = await context.read<T>(key)
  context.signal.throwIfAborted()
  if (saved !== null) return saved
  const result = await context.execute(call)
  context.signal.throwIfAborted()
  if (cacheable(result)) await context.write(key, result)
  return result
}

export function checkpointKey(input: unknown) { return createHash('sha256').update(JSON.stringify(input)).digest('hex') }

/** A completed import phase can contain nested LLM calls. Do not hold a limiter
 * slot around it: concurrency=1 would otherwise deadlock on the inner call. */
export async function checkpointBatchPhase<T>(input: unknown, work: () => Promise<T>): Promise<T> {
  const context = storage.getStore()
  if (!context?.batchCall) return work()
  context.signal.throwIfAborted()
  const key = checkpointKey(input), saved = await context.read<T>(key)
  context.signal.throwIfAborted()
  if (saved !== null) return saved
  const result = await work()
  context.signal.throwIfAborted()
  await context.write(key, result)
  return result
}

export async function reportPdfStage(message: string) {
  const context = storage.getStore()
  context?.signal.throwIfAborted()
  await context?.stage(message)
}
