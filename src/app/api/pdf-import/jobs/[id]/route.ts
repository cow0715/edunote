import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/service'
import { dispatchPdfJob } from '@/lib/pdf-import/gcp'
import { publicPdfJob } from '@/lib/pdf-import/server'
import { isUuid, workerEnabled, type PdfImportJob } from '@/lib/pdf-import/types'
import { bookQualityRetryBlocked } from '@/lib/book-pdf/recovery-policy'
import { examRecoveryBlocked } from '@/lib/pdf-import/exam-completeness'

async function ownedJob(id: string) {
  const { supabase, user } = await getAuth()
  if (!user) return { response: err('인증 필요', 401) }
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return { response: err('강사 정보 없음', 403) }
  if (!isUuid(id)) return { response: err('작업 ID 형식 오류') }
  const { data, error } = await supabase.from('pdf_import_job').select('*').eq('id', id).eq('teacher_id', teacherId).single()
  if (error || !data) return { response: err('작업을 찾을 수 없습니다.', 404) }
  return { job: data as PdfImportJob }
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const outcome = await ownedJob((await params).id)
  return outcome.response ?? ok(publicPdfJob(outcome.job!))
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!workerEnabled()) return err('워커 모드가 비활성화됐습니다.', 503)
  const outcome = await ownedJob((await params).id)
  if (outcome.response) return outcome.response
  const job = outcome.job!
  if (job.result?.batch_stopped === true) return err('배치 접수·결과 기록을 먼저 확인해야 합니다. 중복 접수를 막기 위해 재실행을 중단했습니다.', 409)
  if (job.result?.batch_exhausted === true) return err('자동 재시도할 수 없는 배치 요청입니다. 실패 사유를 확인해주세요. 성공한 요청은 다시 접수하지 않습니다.', 409)
  if (examRecoveryBlocked(job)) return err('누락 문항의 자동 복구를 종료했습니다. 번호별 실패 사유를 확인해주세요. 같은 작업을 다시 접수하지 않습니다.', 409)
  if (bookQualityRetryBlocked(job)) return err('자동 복구 한도 내에 원문 일치를 확정하지 못했습니다. 같은 결과를 그대로 재실행하지 않습니다.', 409)
  if (job.status === 'waiting_batch') {
    if (!publicPdfJob(job).can_retry) return err('배치를 처리 중이며 자동으로 이어집니다.', 409)
    try {
      // Recover a Cloud Tasks delivery outage by waking the same durable job.
      // Claiming preserves its provider IDs and all request/quality budgets.
      await dispatchPdfJob(job.id, job.kind)
      return ok({ accepted: true, job_id: job.id }, { status: 202 })
    } catch { return err('배치 재개 실행을 요청하지 못했습니다. GCP 설정을 확인해주세요.', 503) }
  }
  try {
    const client = createServiceClient()
    const { data, error } = await client.rpc('pdf_import_retry', { p_id: job.id })
    if (error) return err('재실행할 수 없습니다. 다른 작업의 실행 상태를 확인해주세요.', 409)
    if (!data) return err('이미 실행 중이거나 완료된 작업입니다.', 409)
    try { await dispatchPdfJob(job.id, job.kind) } catch {
      await client.from('pdf_import_job').update({ error: '워커 실행 요청을 확인하지 못했습니다. 다시 재실행해주세요.' }).eq('id', job.id).eq('status', 'queued')
      return err('실행 요청을 확인하지 못했습니다. 잠시 후 상태를 확인하고 재실행해주세요.', 503)
    }
    return ok({ job_id: job.id, accepted: true }, { status: 202 })
  } catch { return err('실행 요청을 확인하지 못했습니다. 잠시 후 상태를 확인하고 재실행해주세요.', 503) }
}
