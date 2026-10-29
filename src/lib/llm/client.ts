import { createHash, randomUUID } from 'node:crypto'
import { jsonrepair } from 'jsonrepair'
import { checkpointCall, checkpointKey, getPdfWorkerContext } from '../pdf-import/context'
import { isPdfBatchTask, PdfBatchStopped } from '../pdf-import/batch-policy'
import { LlmError } from './errors'
import { recordUsage } from '../costs/record'
import { getModel, getModelCatalog } from './models'
import { callAnthropic, isAnthropicConfigured } from './providers/anthropic'
import { getDefaultTaskBindings, getTask, getTaskCatalog, isLlmTask, LLM_CONFIG_VERSION, TASK_IDS, type LlmTask } from './tasks'
import type { CallLlmOptions, FileBlock, ImageMimeType, LlmCallMetadata, LlmCallRecord, LlmDetailedResult, LlmExecution } from './types'

// Plain Node/tsx evaluation must work for CLI comparisons; the server-only package
// requires React server conditions even there. Reject browser imports directly.
if (typeof window !== 'undefined') throw new LlmError('configuration', 'LLM 호출 계층은 서버에서만 사용할 수 있습니다.')

const PROVIDERS = {
  anthropic: { isConfigured: isAnthropicConfigured, call: callAnthropic },
} as const

export * from './types'
export type { LlmTask } from './tasks'
export { getTaskCatalog } from './tasks'
export { getModelCatalog, estimateLlmCost } from './models'
export { LlmError, isContentFilterError } from './errors'
export { extractJsonArrayCandidate, extractJsonObjectCandidate, parseJsonArrayResponse, parseJsonObjectResponse, isJsonParseError } from './json'

export function createLlmExecution(overrides: Partial<Record<LlmTask, string>> = {}): LlmExecution {
  const taskBindings = getDefaultTaskBindings()
  for (const [task, modelId] of Object.entries(overrides)) {
    if (!isLlmTask(task)) throw new LlmError('configuration', `알 수 없는 LLM 작업: ${task}`)
    if (typeof modelId !== 'string' || !getModel(modelId)) throw new LlmError('configuration', `등록되지 않은 LLM 모델: ${modelId}`)
    taskBindings[task] = modelId
  }
  for (const task of TASK_IDS) {
    if (!getModel(taskBindings[task])) throw new LlmError('configuration', `등록되지 않은 LLM 모델: ${taskBindings[task]}`)
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ taskBindings, tasks: getTaskCatalog(), models: getModelCatalog() })).digest('hex').slice(0, 12)
  return Object.freeze({ id: randomUUID(), configVersion: `${LLM_CONFIG_VERSION}:${fingerprint}`, taskBindings: Object.freeze(taskBindings), calls: [] })
}

export function isTaskConfigured(task: LlmTask, execution?: LlmExecution): boolean {
  const modelId = (execution?.taskBindings ?? getDefaultTaskBindings())[task]
  const model = getModel(modelId)
  return model ? PROVIDERS[model.provider].isConfigured() : false
}

export function buildFileBlock(fileData: string, mimeType: string, errorMessage = '지원하지 않는 파일 형식입니다 (PDF 또는 이미지만 가능)'): FileBlock {
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)) return { type: 'image', data: fileData, mimeType: mimeType as ImageMimeType }
  if (mimeType === 'application/pdf') return { type: 'pdf', data: fileData, mimeType }
  throw new LlmError('unsupported', errorMessage)
}

function validate(options: CallLlmOptions, model: NonNullable<ReturnType<typeof getModel>>) {
  const phase = options.phase ?? 'generate'
  if (!Number.isInteger(options.maxTokens) || (phase === 'generate' ? options.maxTokens <= 0 : options.maxTokens !== 0) || options.maxTokens > model.capabilities.maxOutputTokens) {
    throw new LlmError('input_limit', '모델이 지원하는 출력 한도를 벗어났습니다.')
  }
  if (phase === 'prewarm' && (!model.capabilities.prewarm || options.cacheBoundary === undefined)) throw new LlmError('unsupported', '선택한 모델 또는 입력은 캐시 예열을 지원하지 않습니다.')
  if (options.stream && !model.capabilities.streaming) throw new LlmError('unsupported', '선택한 모델은 내부 스트리밍을 지원하지 않습니다.')
  if (options.cacheBoundary !== undefined && (!model.capabilities.prefixCache || typeof options.content === 'string' || !Number.isInteger(options.cacheBoundary) || options.cacheBoundary < 0 || options.cacheBoundary >= options.content.length)) {
    throw new LlmError('unsupported', '캐시 경계가 모델 또는 입력과 호환되지 않습니다.')
  }
  if (Array.isArray(options.content)) {
    for (const block of options.content) {
      if (block.type === 'image' && !model.capabilities.image) throw new LlmError('unsupported', '선택한 모델은 이미지를 지원하지 않습니다.')
      if (block.type === 'pdf' && !model.capabilities.pdf) throw new LlmError('unsupported', '선택한 모델은 PDF를 지원하지 않습니다.')
      if (block.type === 'image' && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(block.mimeType)) throw new LlmError('unsupported', '지원하지 않는 이미지 형식입니다.')
    }
  }
  if (options.signal?.aborted) throw new LlmError('cancelled', 'LLM 호출이 취소되었습니다.')
}

async function record(execution: LlmExecution, entry: LlmCallRecord) {
  if (entry.usage) await recordUsage({ provider: 'claude', feature: entry.task, model: entry.responseModel ?? entry.requestedModel, inputTokens: entry.usage.inputTokens ?? 0, outputTokens: entry.usage.outputTokens ?? 0, cacheReadTokens: entry.usage.cacheReadTokens ?? 0, cacheWriteTokens: entry.usage.cacheWriteTokens ?? 0 })
  execution.calls.push(entry)
  // Only hashes and usage are logged; no student answers, prompts or file contents.
  console.log('[llm]', JSON.stringify(entry))
}

function callCheckpoint(options: CallLlmOptions, execution: LlmExecution) {
  return { version: 2, ...options, execution: undefined, signal: undefined, batchRetryGroup: undefined,
    configVersion: execution.configVersion, model: execution.taskBindings[options.task] }
}

/** The initial request remains compatible with checkpoints created before repair support. */
export function llmCallKey(options: CallLlmOptions, execution: LlmExecution) {
  return checkpointKey(callCheckpoint(options, execution))
}

export async function callLlmTextDetailed(options: CallLlmOptions): Promise<LlmDetailedResult> {
  const context = getPdfWorkerContext()
  if (!context) return callLlmTextUncached(options)
  const execution = options.execution ?? createLlmExecution()
  const workerOptions = { ...options, execution, signal: options.signal ? AbortSignal.any([options.signal, context.signal]) : context.signal }
  // Execution IDs and AbortSignals are transient. Routing and prompts determine reuse.
  if (options.phase === 'prewarm') {
    if (context.cacheOnly) throw new PdfBatchStopped('저장 응답 복구 중에는 유료 예열을 허용하지 않습니다.')
    return callLlmTextUncached(workerOptions)
  }
  const checkpoint = callCheckpoint(options, execution)
  return checkpointCall(checkpoint, async () => {
    if (context.batchCall && isPdfBatchTask(options.task)) {
      const model = getModel(execution.taskBindings[options.task])
      if (!model) throw new LlmError('configuration', '배치 모델 설정이 올바르지 않습니다.')
      validate(workerOptions, model)
      const result = await context.batchCall(workerOptions, checkpointKey(checkpoint))
      // Preserve the exam parser's existing per-question refusal/skip behavior.
      if (options.task.startsWith('examBank.') && result.finishReason === 'refusal') {
        throw new LlmError('refusal', 'Output blocked by content filtering (refusal)', { usage: result.usage, execution: result.execution })
      }
      return result
    }
    if (context.cacheOnly) throw new PdfBatchStopped('저장된 응답이 없어 중지했습니다. 추가 비용 방지 모드입니다.')
    return callLlmTextUncached(workerOptions)
  }, (result) => {
    if (result.finishReason !== 'complete') return false
    try {
      const value = JSON.parse(jsonrepair(result.text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')))
      return Array.isArray(value) ? value.length > 0 : value !== null && typeof value === 'object'
    } catch { return false }
  })
}

async function callLlmTextUncached(options: CallLlmOptions): Promise<LlmDetailedResult> {
  if (!isLlmTask(options.task)) throw new LlmError('configuration', `알 수 없는 LLM 작업: ${options.task}`)
  const execution = options.execution ?? createLlmExecution()
  const model = getModel(execution.taskBindings[options.task])
  if (!model) throw new LlmError('configuration', '실행에 등록되지 않은 LLM 모델입니다.')
  const started = Date.now()
  const task = getTask(options.task)
  const metadata: LlmCallMetadata = {
    executionId: execution.id, task: options.task, provider: model.provider,
    requestedModel: model.id, responseModel: null, configVersion: execution.configVersion,
    durationMs: 0, phase: options.phase ?? 'generate',
    promptHash: createHash('sha256').update(typeof options.content === 'string' ? options.content : JSON.stringify(options.content)).digest('hex'),
    promptVersion: task.promptVersion, schemaVersion: task.schemaVersion, sdkRetryCount: null,
  }
  let result: Awaited<ReturnType<typeof callAnthropic>> | undefined
  try {
    validate(options, model)
    result = await PROVIDERS[model.provider].call(options, model)
    metadata.responseModel = result.responseModel
    metadata.durationMs = Date.now() - started
    if (result.finishReason === 'refusal') throw new LlmError('refusal', 'Output blocked by content filtering (refusal)', { usage: result.usage, execution: metadata })
    await record(execution, { ...metadata, usage: result.usage, stopReason: result.stopReason, finishReason: result.finishReason, errorKind: null })
    return { text: result.text, usage: result.usage, stopReason: result.stopReason, finishReason: result.finishReason, execution: metadata }
  } catch (error) {
    metadata.durationMs = Date.now() - started
    const normalized = error instanceof LlmError ? error : new LlmError('provider', error instanceof Error ? error.message : String(error), { cause: error })
    const wrapped = new LlmError(normalized.kind, normalized.message, { usage: result?.usage ?? normalized.usage, execution: metadata, cause: normalized.cause ?? normalized })
    await record(execution, { ...metadata, usage: wrapped.usage, stopReason: result?.stopReason ?? null, finishReason: result?.finishReason ?? null, errorKind: wrapped.kind })
    throw wrapped
  }
}

export async function callLlmText(options: CallLlmOptions): Promise<string> { return (await callLlmTextDetailed(options)).text }
