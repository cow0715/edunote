import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { readBody } from '@/lib/db/input'
import { createClass } from '@/lib/services/classes'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1'
  let query = supabase
    .from('class')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
  if (!includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/classes] class 조회 실패:', error)
    return err(error.message, 500)
  }

  return ok(data)
}

export async function POST(request: Request) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const body = await readBody(request)
    const data = await withTeacherTransaction(user.id, context => createClass(context, body))
    return ok(data, { status: 201 })
  } catch (error) { return saveErrorResponse(error) }
}
