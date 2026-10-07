import { getAuth, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { changeClassWeeks } from '@/lib/services/class-weeks'
export const runtime = 'nodejs'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const ids = await params
    const data = await withTeacherTransaction(user.id, context => changeClassWeeks(context, ids.id, 'sync'))
    return ok(data, { status: 200 })
  } catch (error) { return saveErrorResponse(error) }
}
