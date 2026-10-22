import { err, getAuth, getTeacherAccess } from '../api'

export async function requireCostAdmin() {
  const { supabase, user } = await getAuth()
  if (!user) return err('로그인이 필요합니다.', 401)
  const access = await getTeacherAccess(supabase, user.id)
  if (!access?.is_admin || access.approval_status !== 'approved') return err('관리자 권한이 필요합니다.', 403)
  return null
}
