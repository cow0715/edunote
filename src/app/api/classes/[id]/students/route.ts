import { collectPages } from '@/lib/collect-pages'
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
  try {
    const data = await collectPages((from, to) => supabase.from('class_student')
      .select('*, student(*)').eq('class_id', classId).is('left_at', null)
      .order('joined_at').order('id').range(from, to))
    return ok(data)
  } catch (error) {
    console.error('[GET /api/classes/[id]/students]', error)
    return err('수업 학생 목록 조회 실패', 500)
  }
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
