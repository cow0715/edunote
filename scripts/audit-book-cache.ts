/** Offline only. Never imports a DB client or worker main; no jobs are claimed.
 * Reads the preserved Oct 29 snapshots and response downloads. Writes a report
 * locally; all derived checkpoints are in memory and are never published. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { processNativeBookUnit } from '../src/lib/book-pdf/native-pipeline'
import { inventoryBook } from '../src/lib/book-pdf/inventory'
import { bookPageSlice } from '../src/lib/book-pdf/pdf'
import { bookProofMatches, bookFingerprint, bookSourceFingerprint, bookSourceProofMatches } from '../src/lib/book-pdf/proof'
import { createCallLimiter, withPdfWorkerContext } from '../src/lib/pdf-import/context'
import { PdfBatchStopped } from '../src/lib/pdf-import/batch-policy'
import type { LlmDetailedResult } from '../src/lib/llm/types'
import type { BookExtraction, BookValidation, BookVerification } from '../src/lib/book-pdf/types'

let networkAttempts = 0
globalThis.fetch = async () => { networkAttempts++; throw Error('OFFLINE_NETWORK_BLOCKED') }
process.env.COST_TRACKING_ENABLED = 'false'
delete process.env.ANTHROPIC_API_KEY
type Snapshot = { call_key: string; value: unknown }
type Batch = { id: string; job_id: string; provider_id: string; requests: { key: string; task: string; model: string; configVersion: string; promptHash: string; promptVersion: string; schemaVersion: string }[] }
class MissingDelivery extends PdfBatchStopped {
  constructor(readonly task: string, readonly key: string) { super('OFFLINE_CACHE_MISS:' + task) }
}
async function main() {
  const folder = resolve(process.argv[2] ?? 'tmp/pdfs')
  const sourceFolder = resolve(process.argv[3] ?? 'C:/Users/pc/Documents/카카오톡 받은 파일')
  const load = (file: string) => JSON.parse(readFileSync(resolve(folder, file), 'utf8'))
  const batches: Batch[] = load('midcheck-batches.json')
  const books = [
    ['upper', '수능영독(상).pdf', 'a7f0bd47-1afe-44f5-afe6-275c2f602659', '62410b6c0ab4953ba8ae21527548c2b41a277c1c1493cefcc109a2cfd4541081', 492],
    ['lower', '수특영독(하).pdf', '4824d57b-34df-4edd-9d72-6296d8c5344d', '9b26fe9e76ff0569fc3968fac2984ab3ed8e3afb7a89b22e246533cea9c2a436', 289],
    ['type', '수완(유형).pdf', 'abc9e354-4a8e-4fa8-b568-55a7a4a7dd75', 'e63ca425787882bcf77d60499e0d94ebd0daa195ce4f443f95de35623608606a', 444],
    ['practical', '수완(실전).pdf', '689c49d7-c2d1-40ef-9757-c6c6109bce0a', 'ec8b7227b1244680dae9ccc65353694eb8440b7385dc6ae68a1b6c953042f45c', 352],
  ] as const
  const reports = []
  for (const [index, [tag, file, jobId, pdfHash, expected]] of books.entries()) {
    const bytes = new Uint8Array(readFileSync(resolve(sourceFolder, file)))
    if (createHash('sha256').update(bytes).digest('hex') !== pdfHash) throw Error('SOURCE_HASH_MISMATCH:' + tag)
    const snapshots: Snapshot[] = load(`midcheck-${tag}-checkpoints.json`)
    const stored = new Map(snapshots.map(r => [r.call_key, r.value]))
    for (const batch of batches.filter(b => b.job_id === jobId && ['msgbatch_01NSDkovoyZPTB5zstg8huyY', 'msgbatch_01TUPoo8wK6j5SvhVHAP7XDK'].includes(b.provider_id))) {
      const responses = readFileSync(resolve(folder, batch.provider_id + '.results.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
      const seen = new Set<string>()
      for (const response of responses) {
        const meta = batch.requests.find(r => r.key === response.custom_id)
        if (!meta || seen.has(meta.key) || response.result.type !== 'succeeded') throw Error('INVALID_PRESERVED_DELIVERY')
        seen.add(meta.key)
        const m = response.result.message
        if (m.model !== meta.model) throw Error('MODEL_MISMATCH')
        const result = { text: m.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n'),
          usage: { inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens, cacheReadTokens: m.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: m.usage.cache_creation_input_tokens ?? 0 },
          stopReason: m.stop_reason, finishReason: m.stop_reason === 'end_turn' ? 'complete' : 'other',
          execution: { executionId: batch.id, task: meta.task, provider: 'anthropic', requestedModel: meta.model, responseModel: m.model, configVersion: meta.configVersion, durationMs: 0,
            phase: 'generate', promptHash: meta.promptHash, promptVersion: meta.promptVersion, schemaVersion: meta.schemaVersion, sdkRetryCount: 0, transport: 'batch', batchId: batch.provider_id, callKey: meta.key } }
        const key = 'batch-result:' + meta.key
        if (stored.has(key) && JSON.stringify(stored.get(key)) !== JSON.stringify({ result })) {
          const old = stored.get(key) as { result: LlmDetailedResult }
          if (old.result.text !== result.text || JSON.stringify(old.result.usage) !== JSON.stringify(result.usage)) throw Error('DELIVERY_CONFLICT')
        } else stored.set(key, { result })
      }
      if (seen.size !== batch.requests.length) throw Error('INCOMPLETE_PRESERVED_BATCH')
    }
    const deliveries = [...stored.keys()].filter(k => k.startsWith('batch-result:')).length
    if (deliveries !== expected) throw Error(`SNAPSHOT_INCOMPLETE:${tag}:${deliveries}/${expected}`)
    const manifest = inventoryBook(load(`hwp-inspection/${index}.pages.json`), file)
    if (manifest.errors.length) throw Error('INVENTORY_ERRORS:' + manifest.errors.join(','))
    const report = { file, jobId, pdfHash, units: manifest.units.length, questions: manifest.question_count, savedResponses: deliveries,
      storedSourceProofs: 0, sourceProofs: 0, fullProofs: 0, cachedReads: 0, providerRequests: 0, networkAttempts: 0,
      rows: [] as { unit: string; questions: number; status: string; sourceVerified?: boolean; detail?: string; key?: string }[] }
    const limit = createCallLimiter(2)
    await Promise.all(manifest.units.map(unit => limit(async () => {
      const memory = new Map(stored)
      const sourceKeys = [false, true].map(layout => bookFingerprint({ pipeline: 'native-image-v1', ...(layout ? { layout: 1 } : {}), unit: bookSourceFingerprint(unit), pdfHash, model: 'claude-sonnet-5-5', render: 'poppler-2000' }))
      type Source = { extraction: BookExtraction; verification: BookVerification; validation: BookValidation }
      const hasSource = sourceKeys.some(k => { const s = memory.get(k) as Source | undefined; return s?.extraction && bookSourceProofMatches(s.verification, s.extraction, unit) && !s.validation.errors.length })
      if (hasSource) report.storedSourceProofs++
      const row = { unit: unit.key, questions: unit.questions.length, status: '', sourceVerified: false }
      try {
        const smallBytes = hasSource ? new Uint8Array() : new Uint8Array(Buffer.from(await bookPageSlice(bytes, unit.pages), 'base64'))
        const value = await withPdfWorkerContext({ cacheOnly: true, signal: new AbortController().signal, concurrency: 1, execute: createCallLimiter(1), stage: async () => {},
          read: async <T>(key: string) => { const v = memory.get(key); if (v !== undefined) report.cachedReads++; return (v ?? null) as T | null },
          write: async (key, v) => { memory.set(key, v) },
          batchCall: async (options, key) => {
            const found = memory.get('batch-result:' + key) as { result?: LlmDetailedResult } | undefined
            if (found?.result) { report.cachedReads++; return found.result }
            throw new MissingDelivery(options.task, key)
          },
        }, () => processNativeBookUnit({ unit, pdfHash, bytes: smallBytes }))
        const passed = bookProofMatches({ ...value, manifest: unit, version: 1, verified_version: 1 })
        if (passed) report.fullProofs++
        row.status = passed ? 'full_proof' : 'unresolved'
        report.rows.push({ ...row, detail: value.verification.issues.join(';') })
      } catch (error) {
        if (error instanceof MissingDelivery) report.rows.push({ ...row, status: 'missing_response', detail: error.task, key: error.key })
        else report.rows.push({ ...row, status: 'blocked', detail: error instanceof Error ? error.message : 'unknown' })
      }
      const sourceVerified = sourceKeys.some(k => { const s = memory.get(k) as Source | undefined; return s?.extraction && bookSourceProofMatches(s.verification, s.extraction, unit) && !s.validation.errors.length })
      if (sourceVerified) report.sourceProofs++
      report.rows.find(r => r.unit === unit.key)!.sourceVerified = sourceVerified
    })))
    report.rows.sort((a, b) => Number(a.unit.slice(5)) - Number(b.unit.slice(5)))
    report.networkAttempts = networkAttempts
    if (networkAttempts) throw Error('NETWORK_ATTEMPT_DURING_OFFLINE_AUDIT')
    reports.push(report)
    writeFileSync(resolve(folder, 'four-book-offline-recovery.json'), JSON.stringify({ mode: 'offline-no-provider-no-db-writes', reports }, null, 2))
    console.log(JSON.stringify({ ...report, rows: report.rows.reduce((n, r) => ({ ...n, [r.detail?.startsWith('book.') ? r.detail : r.status]: (n[r.detail?.startsWith('book.') ? r.detail : r.status] ?? 0) + 1 }), {} as Record<string, number>) }))
  }
}
void main().catch(error => { console.error(error.message); process.exitCode = 1 })
