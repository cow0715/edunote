import { z } from 'zod'
import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/service'
import { isUuid, type PdfImportJob } from '@/lib/pdf-import/types'
import { bookRecoveryExcluded } from '@/lib/book-pdf/pilot-review'

async function ownedBook(id: string) {
  const { supabase, user } = await getAuth()
  if (!user) return { response: err('인증 필요', 401) }
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return { response: err('강사 정보 없음', 403) }
  if (!isUuid(id)) return { response: err('작업 ID 형식 오류') }
  const { data, error } = await supabase.from('pdf_import_job').select('*').eq('id', id).eq('teacher_id', teacherId).single()
  if (error || !data || data.kind !== 'bank_book') return { response: err('교재 작업을 찾을 수 없습니다.', 404) }
  const job = data as PdfImportJob
  if (bookRecoveryExcluded(job)) return { response: err('이미 등록된 교재는 재처리 대상에서 제외했습니다.', 409) }
  return { job, teacherId }
}
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const owned = await ownedBook((await params).id)
  if (owned.response) return owned.response
  const { data, error } = await createServiceClient().rpc('book_pdf_pilot_review_info', { p_doc: owned.job!.target_id, p_teacher: owned.teacherId })
  if (error || !data) return err('대표 구간 검토 정보를 불러오지 못했습니다.', 503)
  return ok(data)
}
const approval = z.object({ snapshot: z.string().regex(/^[a-f0-9]{32}$/), confirm: z.literal(true) }).strict()
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const owned = await ownedBook((await params).id)
  if (owned.response) return owned.response
  const parsed = approval.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return err('대표 구간과 예산 확인이 필요합니다.')
  // Approval only. Execution still requires a separate explicit retry action.
  const { data, error } = await createServiceClient().rpc('book_pdf_pilot_approve', { p_doc: owned.job!.target_id, p_teacher: owned.teacherId,
    p_snapshot: parsed.data.snapshot, p_confirm: true })
  if (error || !data) return err('검토 정보나 예산이 변경됐습니다. 새로 불러와 확인해주세요.', 409)
  return ok(data)
}
