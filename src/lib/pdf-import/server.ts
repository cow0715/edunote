import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../supabase/service'
import { dispatchPdfJob, gcpWorkerConfig } from './gcp'
import type { PdfImportJob, PdfImportKind } from './types'
import { bookQualityRetryBlocked } from '../book-pdf/recovery-policy'

export async function weekImportSnapshot(client: SupabaseClient, weekId: string) {
  const { data: questions, error } = await client.from('exam_question').select('*').eq('week_id', weekId).eq('exam_type', 'reading').order('id')
  if (error) throw new Error(error.message)
  const ids = (questions ?? []).map((q) => q.id)
  let answers: unknown[] = []
  if (ids.length) {
    const response = await client.from('student_answer').select('*').in('exam_question_id', ids).order('id')
    if (response.error) throw new Error(response.error.message)
    answers = response.data ?? []
  }
  return createHash('sha256').update(JSON.stringify({ questions, answers })).digest('hex')
}

export async function registerPdfImport(input: {
  kind: PdfImportKind; teacherId: string; authId: string; targetId?: string
  storagePath: string; payload: Record<string, unknown>
  explanationStoragePath?: string
}) {
  gcpWorkerConfig(input.kind) // Fail before reserving work when configuration is missing.
  const client = createServiceClient()
  const { data: previous } = await client.from('pdf_import_job').select('*')
    .eq('teacher_id', input.teacherId).eq('kind', input.kind).eq('upload_path', input.storagePath).maybeSingle()
  if (previous) return { job_id: previous.id, target_id: previous.target_id, status: previous.status, accepted: true }
  const allowedPrefix = input.kind === 'week_answers'
    ? `week-import/${input.targetId}/` : `${input.authId}/`
  if (!input.storagePath.startsWith(allowedPrefix) || input.storagePath.includes('..')) throw new Error('업로드 파일 경로가 올바르지 않습니다. 파일을 다시 올려주세요.')
  const id = randomUUID()
  const sourcePath = `${input.teacherId}/${id}.pdf`
  const explanationPath = input.explanationStoragePath ? `${input.teacherId}/${id}-explanation.pdf` : null
  if (input.explanationStoragePath && (!input.explanationStoragePath.startsWith(`${input.authId}/`) || input.explanationStoragePath.includes('..'))) throw new Error('해설 업로드 경로가 올바르지 않습니다.')
  const { error: copyError } = await client.storage.from('exam-pdf-temp').copy(input.storagePath, sourcePath, { destinationBucket: 'pdf-import-sources' })
  if (copyError) throw new Error(`원본 파일 보관 실패: ${copyError.message}`)
  if (input.explanationStoragePath && explanationPath) {
    const { error } = await client.storage.from('exam-pdf-temp').copy(input.explanationStoragePath, explanationPath, { destinationBucket: 'pdf-import-sources' })
    if (error) {
      await client.storage.from('pdf-import-sources').remove([sourcePath])
      throw new Error(`해설 원본 보관 실패: ${error.message}`)
    }
  }
  const targetId = input.targetId ?? randomUUID()
  const { error } = await client.from('pdf_import_job').insert({
    id, teacher_id: input.teacherId, kind: input.kind, target_id: targetId,
    source_path: sourcePath, upload_path: input.storagePath, payload: { ...input.payload, explanationSourcePath: explanationPath },
  })
  if (error) {
    await client.storage.from('pdf-import-sources').remove([sourcePath, ...(explanationPath ? [explanationPath] : [])])
    if (error.code === '23505') throw new Error('이미 이 자료를 처리 중입니다. 작업 목록에서 진행 상황을 확인해주세요.')
    throw new Error(`작업 등록 실패: ${error.message}`)
  }
  // Immutable source is now durable; queued work does not depend on the temporary object.
  try {
    await client.storage.from('exam-pdf-temp').remove([input.storagePath, ...(input.explanationStoragePath ? [input.explanationStoragePath] : [])])
  } catch { /* Cleanup failure must not hide an already accepted durable job. */ }
  try {
    await dispatchPdfJob(id, input.kind)
  } catch {
    // The HTTP outcome may be uncertain. Preserve queued work and let the owner retry safely.
    try {
      await client.from('pdf_import_job').update({ error: '워커 실행 요청을 확인하지 못했습니다. 작업 목록에서 재실행해주세요.' }).eq('id', id).eq('status', 'queued')
    } catch { /* A queued job remains discoverable even if the warning write fails. */ }
  }
  return { job_id: id, target_id: targetId, status: 'queued', accepted: true }
}

export function publicPdfJob(job: PdfImportJob) {
  return { id: job.id, kind: job.kind, target_id: job.target_id, status: job.status,
    stage: job.stage, completed_calls: job.completed_calls, attempt: job.attempt,
    lease_expires_at: job.lease_expires_at, result: job.result, error: job.error,
    can_retry: (job.status === 'failed' && !bookQualityRetryBlocked(job)) || (job.status === 'running' && !!job.lease_expires_at && new Date(job.lease_expires_at).getTime() < Date.now()) ||
      (job.status === 'queued' && (!!job.error || Date.now() - new Date(job.updated_at).getTime() > 180_000)),
    created_at: job.created_at, updated_at: job.updated_at }
}
