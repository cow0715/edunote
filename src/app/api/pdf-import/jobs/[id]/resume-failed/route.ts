import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/service'
import { dispatchPdfJob } from '@/lib/pdf-import/gcp'
import { isUuid, workerEnabled, type PdfImportJob } from '@/lib/pdf-import/types'
import { bookRecoveryExcluded, bookPilotAwaitingApproval } from '@/lib/book-pdf/pilot-review'
import { bookFailures, canResumeBookFailures } from '@/lib/book-pdf/failure-policy'

const schema = z.object({ units: z.array(z.string().regex(/^unit-\d+$/)).min(1).max(1000), snapshot: z.string().min(1).max(100), confirm: z.literal(true) }).strict()

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!workerEnabled()) return err('워커 모드가 비활성화됐습니다.', 503)
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const teacher = await getTeacherId(supabase, user.id), id = (await params).id
  if (!teacher) return err('강사 정보 없음', 403)
  if (!isUuid(id)) return err('작업 ID 형식 오류')
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!body.success || new Set(body.data.units).size !== body.data.units.length) return err('재개할 보류 구간과 최신 상태 확인이 필요합니다.')
  const { data, error } = await supabase.from('pdf_import_job').select('*').eq('id', id).eq('teacher_id', teacher).single()
  if (error || !data) return err('작업을 찾을 수 없습니다.', 404)
  const job = data as PdfImportJob, failures = bookFailures(job.result)
  if (!canResumeBookFailures(job) || bookRecoveryExcluded(job) || bookPilotAwaitingApproval(job) || job.lease_token
    || job.updated_at !== body.data.snapshot) return err('재개 가능한 보류 구간이 아니거나 상태가 바뀌었습니다. 최신 내역을 확인해주세요.', 409)
  const selected = body.data.units.map(key => failures.find(u => u.unit_key === key))
  if (selected.some(u => !u)) return err('실패한 구간만 선택할 수 있습니다.', 409)
  const client = createServiceClient()
  const active = await client.from('book_pdf_batch').select('id').eq('job_id', id).in('state', ['submitting', 'submitted']).limit(1)
  const cost = await client.from('book_pdf_cost_control').select('stop_reason').eq('document_id', job.target_id).maybeSingle()
  const membership = await client.from('book_pdf_bundle_file').select('bundle_id').eq('document_id', job.target_id).maybeSingle()
  if (active.error || active.data?.length || cost.error || !cost.data || cost.data.stop_reason || membership.error) return err('기존 배치·비용 차단 상태를 먼저 확인해주세요. 새 요청을 접수하지 않았습니다.', 409)
  if (membership.data) {
    const bundle = await client.from('book_pdf_bundle').select('stop_reason').eq('id', membership.data.bundle_id).maybeSingle()
    if (bundle.error || !bundle.data || bundle.data.stop_reason) return err('묶음 처리가 중지돼 있습니다. 차단 상태를 먼저 확인해주세요.', 409)
  }
  const attemptId = randomUUID()
  const queued = await client.from('pdf_import_job').update({ status: 'queued', stage: '선택한 보류 구간 재개 대기', error: null,
    resume_after: null, updated_at: new Date().toISOString(), payload: { ...job.payload, bookFailureResume: { id: attemptId,
      units: selected.map(u => ({ unit_key: u!.unit_key, source_hash: u!.source_hash, stage: u!.stage })) } } })
    .eq('id', id).eq('teacher_id', teacher).eq('status', 'failed').eq('updated_at', body.data.snapshot).is('lease_token', null).select('id').maybeSingle()
  if (queued.error || !queued.data) return err('다른 요청으로 상태가 바뀌었습니다. 중복 재개하지 않았습니다.', 409)
  try { await dispatchPdfJob(id, 'bank_book') }
  catch {
    await client.from('pdf_import_job').update({ error: '워커 연결을 확인하지 못했습니다. 재실행은 저장된 구간 재개 요청을 그대로 사용합니다.' })
      .eq('id', id).eq('teacher_id', teacher).eq('status', 'queued').eq('payload->bookFailureResume->>id', attemptId)
    return err('재개 접수는 저장했지만 워커 연결을 확인하지 못했습니다. 새로 등록하지 말고 처리 내역에서 재실행해주세요.', 503)
  }
  return ok({ accepted: true, job_id: id, units: body.data.units }, { status: 202 })
}
