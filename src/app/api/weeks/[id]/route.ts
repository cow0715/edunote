import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { readBody } from '@/lib/db/input'
import { updateWeek } from '@/lib/services/class-weeks'
export const runtime = 'nodejs'
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, id, teacherId)) return err('접근 권한 없음', 403)

  const { data, error } = await supabase
    .from('week')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[GET /api/weeks/[id]]', error)
    return err(error.message, 500)
  }

  return ok(data)
}


export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const ids = await params
    const body = await readBody(request)
    const data = await withTeacherTransaction(user.id, context => updateWeek(context, ids.id, body))
    return ok(data, { status: 200 })
  } catch (error) { return saveErrorResponse(error) }
}
