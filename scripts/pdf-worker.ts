import { randomUUID } from 'node:crypto'
import { createServiceClient } from '../src/lib/supabase/service'
import { createCallLimiter, withPdfWorkerContext, type PdfWorkerContext } from '../src/lib/pdf-import/context'
import { isUuid, type PdfImportJob } from '../src/lib/pdf-import/types'

export async function main() {
  if (process.argv.includes('--help')) {
    console.log('PDF worker: PDF_IMPORT_JOB_ID=<uuid> npm run worker\nRequired: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.\nOptional: PDF_WORKER_CONCURRENCY (1-32, default 8). A worker handles one job and exits.')
    return
  }
  const id = process.env.PDF_IMPORT_JOB_ID
  if (!isUuid(id)) throw new Error('PDF_IMPORT_JOB_ID에 작업 UUID를 지정해주세요.')
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY가 필요합니다.')
  const client = createServiceClient()
  const token = randomUUID()
  const controller = new AbortController()
  const terminate = () => controller.abort(new Error('워커 종료 요청'))
  const concurrency = Math.min(32, Math.max(1, Number.parseInt(process.env.PDF_WORKER_CONCURRENCY ?? '8', 10) || 8))
  let job: PdfImportJob | undefined
  // On hard termination, Cloud Run can restart before the previous lease expires.
  for (let i = 0; i < 36; i++) {
    controller.signal.throwIfAborted()
    const { data, error } = await client.rpc('pdf_import_claim', { p_id: id, p_token: token })
    if (error) throw new Error(`작업 확보 실패: ${error.message}`)
    job = data?.[0] as PdfImportJob | undefined
    if (job) break
    const current = await client.from('pdf_import_job').select('status,lease_expires_at').eq('id', id).single()
    if (current.error) throw new Error('작업을 찾을 수 없습니다.')
    if (current.data.status === 'succeeded') return
    if (current.data.status === 'failed') throw new Error('실패한 작업입니다. 작업 목록에서 재실행해주세요.')
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  if (!job) throw new Error('다른 워커가 작업 중입니다.')
  process.once('SIGTERM', terminate)
  process.once('SIGINT', terminate)
  let beating = false
  const heartbeat = async (stage?: string) => {
    controller.signal.throwIfAborted()
    const { data, error } = await client.rpc('pdf_import_heartbeat', { p_id: id, p_token: token, p_stage: stage ?? null })
    if (error || !data) throw new Error('워커 작업 권한을 갱신하지 못했습니다.')
  }
  const timer = setInterval(() => {
    if (beating) return
    beating = true
    void heartbeat().catch((error) => controller.abort(error)).finally(() => { beating = false })
  }, 30_000)
  const context: PdfWorkerContext = {
    signal: controller.signal, concurrency, execute: createCallLimiter(concurrency), stage: heartbeat,
    read: async <T>(key: string) => {
      const { data, error } = await client.from('pdf_import_checkpoint').select('value').eq('job_id', id).eq('call_key', key).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? data.value as T : null
    },
    write: async (key, value) => {
      const { error } = await client.rpc('pdf_import_save_checkpoint', { p_id: id, p_token: token, p_key: key, p_value: value })
      if (error) throw new Error(error.message)
    },
  }
  try {
    const { runPdfImport } = await import('../src/lib/pdf-import/handlers')
    const result = await withPdfWorkerContext(context, () => runPdfImport(client, job!))
    const unresolved = job!.kind === 'bank_book' && result.verification_unresolved === true
    const { data, error } = await client.rpc('pdf_import_finish', { p_id: id, p_token: token, p_status: unresolved ? 'failed' : 'succeeded', p_result: result,
      p_error: unresolved ? Array.isArray(result.inventory_errors) ? '원문 문항 경계를 확정하지 못해 등록을 보류했습니다.' : '자동 대조·복구 후 확정하지 못한 항목이 있어 등록을 보류했습니다.' : null })
    if (error || !data) throw new Error('완료 상태 저장 실패')
    // Quality recovery already exhausted its bounded budget; don't start another paid platform retry.
    if (unresolved) { console.log(`[pdf-worker] verification-unresolved ${id}`); return }
    console.log(`[pdf-worker] completed ${id}`)
  } catch (error) {
    controller.abort(error) // Stop any remaining parallel AI calls before releasing the lease.
    const message = error instanceof Error ? error.message : 'PDF 처리 실패'
    const attempt = Number(process.env.CLOUD_RUN_TASK_ATTEMPT ?? '3')
    await client.rpc('pdf_import_finish', { p_id: id, p_token: token, p_status: attempt < 3 ? 'queued' : 'failed', p_result: null, p_error: message.slice(0, 500) })
    throw error
  } finally {
    clearInterval(timer)
    process.removeListener('SIGTERM', terminate)
    process.removeListener('SIGINT', terminate)
  }
}

if (require.main === module) {
  main().catch((error) => {
    // Do not log raw SDK errors or request objects: those can include keys and document text.
    console.error(`[pdf-worker] ${error instanceof Error ? error.message : '실행 실패'}`)
    process.exitCode = 1
  })
}
