import { getAuth, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { changeEnrollment } from '@/lib/services/students'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const { id, studentId } = await params
    const body = await request.json()
    const result = await withTeacherTransaction(user.id, context => changeEnrollment(context, studentId, id, 'join_date', body))
    return ok(result)
  } catch (error) { return saveErrorResponse(error) }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; studentId: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const { id, studentId } = await params
    const body = await request.json().catch(() => ({}))
    const result = await withTeacherTransaction(user.id, context => changeEnrollment(context, studentId, id, 'withdraw', body))
    return ok(result)
  } catch (error) { return saveErrorResponse(error) }
}
