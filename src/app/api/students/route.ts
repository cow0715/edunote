import { getAuth, getTeacherId, err, ok } from '@/lib/api'

import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { registerStudent } from '@/lib/services/students'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { data, error } = await supabase
    .from('student')
    .select('*, class_student(class_id, joined_at, left_at, class:class_id(name))')
    .eq('teacher_id', teacherId)
    .order('name')

  if (error) {
    console.error('[GET /api/students]', error)
    return err(error.message, 500)
  }

  return ok(data)
}

export async function POST(request: Request) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const body = await request.json()
    const result = await withTeacherTransaction(user.id, context => registerStudent(context, body))
    return ok(result, { status: 201 })
  } catch (error) { return saveErrorResponse(error) }
}
