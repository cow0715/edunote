import { getAuth, err, ok } from '@/lib/api'

import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { editStudent, removeStudent } from '@/lib/services/students'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const { id } = await params
    const body = await request.json()
    const result = await withTeacherTransaction(user.id, context => editStudent(context, id, body))
    return ok(result)
  } catch (error) { return saveErrorResponse(error) }
}
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const { id } = await params
    const result = await withTeacherTransaction(user.id, context => removeStudent(context, id))
    return ok(result)
  } catch (error) { return saveErrorResponse(error) }
}
