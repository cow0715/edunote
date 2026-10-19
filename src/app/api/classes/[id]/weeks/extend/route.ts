import { getAuth, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { readBody } from '@/lib/db/input'
import { changeClassWeeks } from '@/lib/services/class-weeks'
export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const ids = await params
    const body = await readBody(request)
    const data = await withTeacherTransaction(user.id, context => changeClassWeeks(context, ids.id, 'extend', body))
    return ok(data, { status: 200 })
  } catch (error) { return saveErrorResponse(error) }
}
