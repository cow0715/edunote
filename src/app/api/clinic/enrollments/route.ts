import { getAuth, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { readBody } from '@/lib/db/input'
import { saveErrorResponse } from '@/lib/db/errors'
import { saveClinicEnrollment } from '@/lib/services/clinic-enrollments'

export async function POST(request: Request) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const body = await readBody(request)
    return ok(await withTeacherTransaction(user.id, context => saveClinicEnrollment(context, body)))
  } catch (error) { return saveErrorResponse(error) }
}
