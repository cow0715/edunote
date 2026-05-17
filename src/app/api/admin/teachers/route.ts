import { err, getAuth, getTeacherAccess, ok, type TeacherApprovalStatus } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'

const allowedStatuses = new Set<TeacherApprovalStatus>(['pending', 'approved', 'blocked'])

async function requireAdmin() {
  const { supabase, user } = await getAuth()
  if (!user) return { supabase, user: null, admin: null, error: err('로그인이 필요합니다', 401) }

  const admin = await getTeacherAccess(supabase, user.id)
  if (!admin || admin.approval_status !== 'approved' || !admin.is_admin) {
    return { supabase, user, admin, error: err('관리자 권한이 필요합니다', 403) }
  }

  return { supabase, user, admin, error: null }
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const service = createServiceClient()
  const { data, error: queryError } = await service
    .from('teacher')
    .select('id, email, name, approval_status, is_admin, created_at, approved_at')
    .order('created_at', { ascending: false })

  if (queryError) return err(queryError.message, 400)
  return ok({ teachers: data ?? [] })
}

export async function PATCH(request: Request) {
  const { admin, error } = await requireAdmin()
  if (error) return error

  const service = createServiceClient()
  const { teacherId, status } = await request.json()

  if (!teacherId || !allowedStatuses.has(status)) {
    return err('올바른 승인 상태가 아닙니다')
  }

  const update =
    status === 'approved'
      ? {
          approval_status: status,
          approved_at: new Date().toISOString(),
          approved_by: admin!.id,
        }
      : {
          approval_status: status,
          approved_at: null,
          approved_by: null,
        }

  const { data, error: updateError } = await service
    .from('teacher')
    .update(update)
    .eq('id', teacherId)
    .select('id, approval_status')
    .single()

  if (updateError) return err(updateError.message, 400)
  return ok({ success: true, teacher: data })
}
