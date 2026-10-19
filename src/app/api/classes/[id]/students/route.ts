import { getAuth, getTeacherId, assertClassOwner, err, ok } from '@/lib/api'

import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { enrollStudent } from '@/lib/services/students'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)
  const { data, error } = await supabase.from('class_student').select('*, student(*)').eq('class_id', classId).is('left_at', null).order('joined_at')
  if (error) { console.error('[GET /api/classes/[id]/students]', error); return err(error.message, 500) }
  return ok(data)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const { id } = await params
    const body = await request.json()
    const result = await withTeacherTransaction(user.id, context => enrollStudent(context, id, body))
    return ok(result, { status: 201 })
  } catch (error) { return saveErrorResponse(error) }
}
