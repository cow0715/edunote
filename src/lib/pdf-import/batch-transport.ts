import Anthropic from '@anthropic-ai/sdk'
import type { BatchCreateParams, MessageBatch, MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { getModel } from '../llm/models'
import { getTask } from '../llm/tasks'
import { buildAnthropicRequest } from '../llm/providers/anthropic'
import type { CallLlmOptions, LlmDetailedResult } from '../llm/types'
import type { PdfWorkerContext } from './context'
import { getPdfWorkerContext } from './context'
import { costEnvironment } from '../costs/record'
import { BOOK_BATCH_WINDOW, batchCostReservation, bookCostProtocol, PdfCostStopped, type BookCostSummary } from './cost-policy'
import { SOURCE_MAP_PROMPT } from '../book-pdf/map-source'
import { BOOK_PROFILE_VERSION } from '../book-pdf/profiles'
import { EXPLANATION_WRITING_RULES } from '../llm/material-enrichment-contract'
import { NATIVE_RECOVERY_REVISION } from '../book-pdf/recovery-policy'
import { SOURCE_AUDIT_PROMPT, SOURCE_AUDIT_REPAIR_PROMPT, SOURCE_PATCH_REPAIR_PROMPT } from '../book-pdf/audit-source'
import type { PdfImportJob } from './types'
import { allowsPdfBatchTask } from './batch-policy'
import { PDF_BATCH_MAX_BYTES, PDF_BATCH_REQUEST_ATTEMPTS, PdfBatchPending, PdfBundleDeferred, PdfBatchRequestFailed, PdfBatchStopped, retryableBatchResult } from './batch-policy'

type RequestMeta = { key: string; retryGroup?: string; unitKey?: string; maxOutputTokens?: number; task: CallLlmOptions['task']; model: string; configVersion: string; promptHash: string; promptVersion: string; schemaVersion: string }
type BatchRow = { id: string; provider_id: string | null; state: 'submitting' | 'submitted' | 'ended' | 'rejected'; requests: RequestMeta[]; created_at: string; outcomes?: Record<string, string> }
type Delivery = { result: LlmDetailedResult } | { error: string; attempts?: number }
type Pending = { meta: RequestMeta; request: BatchCreateParams.Request; bytes: number }
export type PdfBatchProvider = {
  countTokens?: (request: BatchCreateParams.Request) => Promise<number>
  create: (requests: BatchCreateParams.Request[]) => Promise<MessageBatch>
  retrieve: (id: string) => Promise<MessageBatch>
  results: (id: string) => Promise<AsyncIterable<MessageBatchIndividualResponse>>
}

/** No provider key or network access is needed to consume persisted deliveries. */
export function cachedPdfBatchProvider(): PdfBatchProvider {
  const blocked = async (): Promise<never> => { throw new PdfBatchStopped('저장 응답 복구 모드에서는 공급사 API에 접근하지 않습니다. 아직 수집하지 않은 배치는 별도 확인이 필요합니다.') }
  return { create: blocked, retrieve: blocked, results: blocked, countTokens: blocked }
}

export function anthropicPdfBatchProvider(signal: AbortSignal): PdfBatchProvider {
  const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return {
    countTokens: async ({ params }) => (await sdk.messages.countTokens({ model: params.model, messages: params.messages,
      ...(params.system ? { system: params.system } : {}), ...(params.tools ? { tools: params.tools } : {}) }, { signal, maxRetries: 1, timeout: 30_000 })).input_tokens,
    // Batch creation has no documented idempotency key. Never let the SDK replay an uncertain POST.
    create: (requests) => sdk.messages.batches.create({ requests }, { signal, maxRetries: 0, timeout: 60_000 }),
    retrieve: (id) => sdk.messages.batches.retrieve(id, { signal, maxRetries: 2, timeout: 30_000 }),
    results: (id) => sdk.messages.batches.results(id, { signal, maxRetries: 2, timeout: 60_000 }),
  }
}

/** Replays the existing domain pipeline from immutable checkpoints. Missing
 * responses are collected, not synchronously generated. Inputs stay in memory;
 * the durable batch ledger contains identities/outcomes, never PDF base64. */
export class PdfBatchTransport {
  private rows: BatchRow[] = []
  private pending = new Map<string, Pending>()
  private pendingBytes = 32
  constructor(private db: SupabaseClient, private job: PdfImportJob, private context: PdfWorkerContext, private provider: PdfBatchProvider) {
    if (job.kind === 'bank_book' && !context.cacheOnly) context.canPrepareUnit = (unit) => this.pending.size < (job.payload?.bookProfile === BOOK_PROFILE_VERSION ? 4 : BOOK_BATCH_WINDOW)
      || [...this.pending.values()].some((entry) => entry.meta.unitKey === unit)
  }

  private async update(row: BatchRow, state: BatchRow['state'], providerId: string | null, outcomes: Record<string, string> = {}) {
    const { error } = await this.db.rpc('book_pdf_batch_update', { p_job: this.job.id, p_token: this.job.lease_token,
      p_batch: row.id, p_state: state, p_provider: providerId, p_outcomes: outcomes })
    if (error) throw new Error('PDF 배치 상태 저장 실패')
    row.state = state; row.provider_id = providerId; row.outcomes = outcomes
  }

  private async recordBatchUsage(row: BatchRow) {
    const key = `batch-cost-recorded:${row.id}`
    if (await this.context.read(key)) return
    const { error } = await this.db.rpc('pdf_batch_record_usage', { p_job: this.job.id, p_token: this.job.lease_token,
      p_batch: row.id, p_environment: costEnvironment() })
    if (error) throw new PdfBatchStopped('Batch 비용 기록·예산 정산 실패로 새 접수를 중지했습니다. 비용 관리 SQL을 확인해주세요.')
    await this.context.write(key, true)
  }

  async poll(): Promise<boolean> {
    const { data, error } = await this.db.from('book_pdf_batch').select('*').eq('job_id', this.job.id).order('created_at')
    if (error) throw new Error('PDF 배치 DB 마이그레이션을 확인해주세요.')
    this.rows = data ?? []
    let waiting = false
    for (const row of this.rows) {
      this.context.signal.throwIfAborted()
      if (row.state === 'submitting') throw new PdfBatchStopped('배치 접수 여부를 확정하지 못했습니다. 중복 과금을 막기 위해 자동 재접수를 중단했습니다. 배치 기록 확인이 필요합니다.')
      if (row.state === 'ended' || row.state === 'rejected') { await this.recordBatchUsage(row); continue }
      if (row.state !== 'submitted' || !row.provider_id) continue
      const batch = await this.provider.retrieve(row.provider_id)
      if (batch.processing_status !== 'ended') {
        if (Date.now() - Date.parse(row.created_at) > 26 * 3600_000) throw new PdfBatchStopped('배치가 26시간 이상 완료되지 않았습니다. 기존 배치 확인이 필요합니다.')
        waiting = true; continue
      }
      const byKey = new Map(row.requests.map((r) => [r.key, r])), seen = new Set<string>(), outcomes: Record<string, string> = {}
      for await (const response of await this.provider.results(row.provider_id)) {
        const meta = byKey.get(response.custom_id)
        if (!meta || seen.has(response.custom_id)) throw new PdfBatchStopped('배치 결과의 요청 식별자가 중복되거나 일치하지 않습니다.')
        seen.add(response.custom_id)
        const result = response.result
        if (result.type === 'succeeded') {
          const message = result.message
          const value: LlmDetailedResult = {
            text: message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
            usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens,
              cacheReadTokens: message.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0 },
            stopReason: message.stop_reason,
            finishReason: message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence' ? 'complete'
              : message.stop_reason === 'max_tokens' ? 'length' : message.stop_reason === 'refusal' ? 'refusal' : 'other',
            execution: { executionId: row.id, task: meta.task, provider: 'anthropic', requestedModel: meta.model, responseModel: message.model,
              configVersion: meta.configVersion, durationMs: 0, phase: 'generate', promptHash: meta.promptHash,
              promptVersion: meta.promptVersion, schemaVersion: meta.schemaVersion, sdkRetryCount: 0,
              transport: 'batch', batchId: row.provider_id, callKey: meta.key },
          }
          // Persist even truncated/malformed output in a delivery checkpoint. Domain
          // code sees the same response on restart and retains its bounded repair budget.
          const deliveryKey = `batch-result:${meta.key}`
          if (await this.context.read(deliveryKey) === null) {
            await this.context.write(deliveryKey, { result: value } satisfies Delivery)
            console.log('[llm]', JSON.stringify({ ...value.execution, usage: value.usage, stopReason: value.stopReason, finishReason: value.finishReason, errorKind: null }))
          }
          outcomes[meta.key] = 'succeeded'
        } else {
          const type = result.type === 'errored' ? result.error.error.type : result.type
          outcomes[meta.key] = type
          if (!retryableBatchResult(type) || this.attempts(meta.key, meta.retryGroup) >= PDF_BATCH_REQUEST_ATTEMPTS) {
            await this.context.write(`batch-result:${meta.key}`, { error: `배치 ${getTask(meta.task).label} 요청 실패 (${type}, 접수 ${this.attempts(meta.key, meta.retryGroup)}회). 자동 재요청을 중단했습니다.`, attempts: this.attempts(meta.key, meta.retryGroup) } satisfies Delivery)
          }
        }
      }
      if (seen.size !== byKey.size) throw new Error('배치 결과가 일부 누락됐습니다. 같은 배치 결과를 다시 조회합니다.')
      await this.update(row, 'ended', row.provider_id, outcomes)
      await this.recordBatchUsage(row)
    }
    return waiting
  }

  private attempts(key: string, group = key) {
    return this.rows.filter(row => !(row.state === 'rejected' && row.outcomes?.__not_sent__ === 'deferred'))
      .flatMap((row) => row.requests).filter((meta) => meta.key === key || meta.key === group || meta.retryGroup === group).length
  }

  call = async (options: CallLlmOptions, key: string): Promise<LlmDetailedResult> => {
    this.context.signal.throwIfAborted()
    if (!allowsPdfBatchTask(this.job.kind, options.task) || !options.execution || options.phase === 'prewarm') throw new PdfBatchStopped('이 PDF 작업에서 허용되지 않은 배치 요청입니다.')
    const saved = await this.context.read<Delivery>(`batch-result:${key}`)
    if (saved) {
      if ('error' in saved) throw new PdfBatchRequestFailed(saved.error, saved.attempts)
      return saved.result
    }
    if (this.context.cacheOnly) throw new PdfBatchStopped('저장된 응답이 없는 구간입니다. 추가 비용 방지 모드에서는 새 요청을 접수하지 않습니다.')
    if (this.attempts(key, options.batchRetryGroup) >= PDF_BATCH_REQUEST_ATTEMPTS) throw new PdfBatchRequestFailed('배치 요청을 최초 포함 3회 접수했지만 완료하지 못했습니다.', PDF_BATCH_REQUEST_ATTEMPTS)
    if (!this.pending.has(key)) {
      const model = getModel(options.execution.taskBindings[options.task])
      if (!model) throw new PdfBatchStopped('PDF 배치 모델 설정이 올바르지 않습니다.')
      const params = buildAnthropicRequest(options, model), task = getTask(options.task)
      const request = { custom_id: key, params }, bytes = Buffer.byteLength(JSON.stringify(request))
      if (bytes + 32 > PDF_BATCH_MAX_BYTES) throw new PdfBatchStopped('지문 묶음 하나의 배치 요청이 32MiB를 초과합니다. 원문을 임의로 잘라 처리하지 않습니다.')
      // Bound retained base64/JSON across all units, in addition to the two-unit
      // parsing/rasterization limit. Uncollected units replay on the next wake.
      if (this.pending.size >= 1000 || this.pendingBytes + bytes + 1 > PDF_BATCH_MAX_BYTES) throw new PdfBatchPending()
      const unitKey = getPdfWorkerContext()?.unitKey ?? this.context.unitKey
      if (this.job.kind === 'bank_book' && !/^unit-[0-9]+$/.test(unitKey ?? '')) throw new PdfBatchStopped('교재 비용을 연결할 지문 식별자가 없어 접수를 중지했습니다.')
      if (this.job.kind === 'bank_book' && this.pending.size >= (this.job.payload?.bookProfile === BOOK_PROFILE_VERSION ? 4 : BOOK_BATCH_WINDOW)) throw new PdfBatchPending()
      this.pending.set(key, { request, bytes, meta: { key, ...(this.job.kind === 'bank_book' ? { unitKey, maxOutputTokens: options.maxTokens } : {}), ...(options.batchRetryGroup ? { retryGroup: options.batchRetryGroup } : {}), task: options.task, model: model.id, configVersion: options.execution.configVersion,
        promptHash: createHash('sha256').update(typeof options.content === 'string' ? options.content : JSON.stringify(options.content)).digest('hex'),
        promptVersion: task.promptVersion, schemaVersion: task.schemaVersion } })
      this.pendingBytes += bytes + 1
    }
    throw new PdfBatchPending()
  }

  async submit() {
    // Also fence submit itself: requests might have been collected before an
    // operator enabled the guard. Cache-only recovery never posts to the provider.
    if (this.context.cacheOnly) throw new PdfBatchStopped('추가 비용 방지 모드에서는 배치 접수를 허용하지 않습니다.')
    const chunks: Pending[][] = []; let chunk: Pending[] = [], bytes = 32
    for (const request of this.pending.values()) {
      if (chunk.length && bytes + request.bytes + 1 > PDF_BATCH_MAX_BYTES) { chunks.push(chunk); chunk = []; bytes = 32 }
      chunk.push(request); bytes += request.bytes + 1
    }
    if (chunk.length) chunks.push(chunk)
    if (!chunks.length) throw new PdfBatchStopped('배치 대기 요청이 없습니다.')
    for (const entries of chunks) {
      this.context.signal.throwIfAborted()
      const estimates: { key: string; unitKey: string; inputLimit: number; maxOutputTokens: number }[] = []
      if (this.job.kind === 'bank_book') {
        const status = await this.db.rpc('book_pdf_cost_summary', { p_job: this.job.id, p_token: this.job.lease_token })
        if (status.error || !status.data) throw new PdfBatchStopped('파일 예산을 확인하지 못해 접수를 중지했습니다. 비용 관리 SQL을 확인해주세요.')
        const info = status.data as BookCostSummary
        if (!info.allowed) { if (['bundle_busy', 'bundle_preparing'].includes(info.reason ?? '')) throw new PdfBundleDeferred(); throw new PdfCostStopped(info) }
        if (!Number.isSafeInteger(info.call_limit) || info.call_limit! <= 0 || !Number.isSafeInteger(info.calls_used) || info.calls_used! < 0) {
          throw new PdfBatchStopped('파일 누적 호출 상한 SQL이 적용되지 않아 새 접수를 중지했습니다.')
        }
        if (info.calls_used! + entries.length > info.call_limit!) throw new PdfCostStopped({ ...info, allowed: false, reason: 'file_call_limit' })
        if (!this.provider.countTokens) throw new PdfBatchStopped('입력 토큰 계산 기능이 없어 접수를 중지했습니다.')
        for (const entry of entries) {
          const countKey = `batch-token-count:${entry.meta.key}`
          let count = await this.context.read<number>(countKey)
          if (count === null) {
            try { count = await this.provider.countTokens(entry.request) } catch { throw new PdfBatchStopped('입력 토큰 계산 실패로 접수를 중지했습니다. 생성 요청은 보내지 않았습니다.') }
            await this.context.write(countKey, count)
          }
          const reservation = batchCostReservation(entry.meta.model, count, entry.request.params.max_tokens)
          estimates.push({ key: entry.meta.key, unitKey: entry.meta.unitKey!, inputLimit: reservation.inputLimit, maxOutputTokens: reservation.maxOutputTokens })
        }
      }
      const { data, error } = await this.db.rpc('book_pdf_batch_prepare', { p_job: this.job.id, p_token: this.job.lease_token, p_requests: entries.map((r) => r.meta) })
      if (error || !data?.[0]) {
        if (this.job.kind === 'bank_book') throw new PdfBatchStopped('교재 배치 호출 상한 또는 접수 기록 검사를 통과하지 못했습니다. 새 요청을 보내지 않았습니다.')
        throw new Error('배치 접수 기록을 확보하지 못했습니다.')
      }
      const row = data[0] as BatchRow
      this.rows.push(row)
      if (this.job.kind === 'bank_book') {
        const result = await this.db.rpc('book_pdf_cost_reserve', { p_job: this.job.id, p_token: this.job.lease_token,
          p_batch: row.id, p_estimates: estimates, p_protocol: bookCostProtocol([SOURCE_MAP_PROMPT, SOURCE_AUDIT_PROMPT, SOURCE_AUDIT_REPAIR_PROMPT, SOURCE_PATCH_REPAIR_PROMPT,
            EXPLANATION_WRITING_RULES, `native-recovery:${NATIVE_RECOVERY_REVISION}`,
            ...(this.job.payload?.bookProfile === BOOK_PROFILE_VERSION ? [BOOK_PROFILE_VERSION] : [])], entries[0].meta.configVersion) })
        if (result.error || !result.data || !result.data.allowed) {
          const deferred = ['bundle_busy', 'bundle_preparing'].includes(result.data?.reason ?? '')
          await this.update(row, 'rejected', null, deferred ? { __not_sent__: 'deferred' } : {})
          if (deferred) throw new PdfBundleDeferred()
          if (result.data) throw new PdfCostStopped(result.data as BookCostSummary)
          throw new PdfBatchStopped('파일 예산 예약에 실패해 생성 요청을 보내지 않았습니다.')
        }
      }
      let batch: MessageBatch
      try { batch = await this.provider.create(entries.map((r) => r.request)) }
      catch (error) {
        if (error instanceof Anthropic.APIError && error.status && error.status >= 400 && error.status < 500 && error.status !== 408) {
          await this.update(row, 'rejected', null, Object.fromEntries(entries.map((r) => [r.meta.key, `http_${error.status}`])))
          await this.recordBatchUsage(row)
          if (error.status !== 429) for (const entry of entries) await this.context.write(`batch-result:${entry.meta.key}`, { error: `배치 접수가 거절됐습니다 (HTTP ${error.status}). 설정·요청 확인이 필요합니다.`, attempts: this.attempts(entry.meta.key, entry.meta.retryGroup) } satisfies Delivery)
          continue
        }
        throw new PdfBatchStopped('배치 접수 응답을 확인하지 못했습니다. 중복 과금을 막기 위해 자동 재접수를 중단했습니다. 배치 기록 확인이 필요합니다.')
      }
      try { await this.update(row, 'submitted', batch.id) }
      catch { throw new PdfBatchStopped(`배치 ${batch.id}는 접수됐지만 연결 기록을 저장하지 못했습니다. 중복 접수를 중단했습니다.`) }
    }
    this.pending.clear()
    this.pendingBytes = 32
  }
}
