import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { workerEnabled } from '@/lib/pdf-import/types'
import { createServiceClient } from '@/lib/supabase/service'

// DELETE — 기출 시험 삭제 (cascade로 문항도 삭제)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params

  if (workerEnabled()) {
    const { data, error } = await createServiceClient().rpc('pdf_import_delete_exam', { p_id: id, p_teacher_id: teacherId })
    if (error?.code === '55000') return err('PDF 처리 중인 자료입니다. 작업 완료 후 삭제해주세요.', 409)
    if (error) return err('PDF 작업 상태를 확인하지 못했습니다.', 503)
    if (!data) return err('시험을 찾을 수 없습니다.', 404)
    return ok({ ok: true })
  }

  const { error } = await supabase
    .from('exam_bank')
    .delete()
    .eq('id', id)
    .eq('teacher_id', teacherId)

  if (error) return err(error.message)
  return ok({ ok: true })
}
