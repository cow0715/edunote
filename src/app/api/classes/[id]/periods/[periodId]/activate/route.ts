import { getAuth, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { managePeriod } from '@/lib/services/class-periods'
export const runtime = 'nodejs'

export async function POST(_: Request, { params }: { params: Promise<{ id: string; periodId: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const ids = await params
    const data = await withTeacherTransaction(user.id, context => managePeriod(context, ids.id, 'set_default', ids.periodId))
    return ok(data, { status: 200 })
  } catch (error) { return saveErrorResponse(error) }
}
