import { monitorApi } from '@/lib/report-operational-failure'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { getAuth, err, ok } from '@/lib/api'
import { confirmGrades } from '@/lib/services/grade-confirm'

async function monitoredPATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    const { id } = await params
    const body: unknown = await request.json()
    return ok(await withTeacherTransaction(user.id, context => confirmGrades(context, id, body)))
  } catch (error) { return saveErrorResponse(error) }
}

export const PATCH = monitorApi('grade-confirm', monitoredPATCH)
