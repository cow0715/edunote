import { getAuth, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { readBody } from '@/lib/db/input'
import { managePeriod } from '@/lib/services/class-periods'
export const runtime = 'nodejs'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const ids = await params
    const body = await readBody(request)
    const data = await withTeacherTransaction(user.id, context => managePeriod(context, ids.id, 'edit', ids.periodId, body))
    return ok(data, { status: 200 })
  } catch (error) { return saveErrorResponse(error) }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const ids = await params
    const data = await withTeacherTransaction(user.id, context => managePeriod(context, ids.id, 'delete', ids.periodId))
    return ok(data, { status: 200 })
  } catch (error) { return saveErrorResponse(error) }
}
