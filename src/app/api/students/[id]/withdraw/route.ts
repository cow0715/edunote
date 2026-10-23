import { getAuth, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { changeEnrollment } from '@/lib/services/students'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const { id } = await params
    const body = await request.json()
    if (!body.left_at) return err('퇴원일 필요')
    const result = await withTeacherTransaction(user.id, context => changeEnrollment(context, id, null, 'withdraw', body))
    return ok(result)
  } catch (error) { return saveErrorResponse(error) }
}
