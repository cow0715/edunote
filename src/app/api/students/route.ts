import { collectPages } from '@/lib/collect-pages'
import { getAuth, getTeacherId, err, ok } from '@/lib/api'

import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { registerStudent } from '@/lib/services/students'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  try {
    const data = await collectPages((from, to) => supabase.from('student')
      .select('*, class_student(class_id, joined_at, left_at, class:class_id(name))')
      .eq('teacher_id', teacherId).order('name').order('id').range(from, to))
    return ok(data)
  } catch (error) {
    console.error('[GET /api/students]', error)
    return err('학생 목록 조회 실패', 500)
  }
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
