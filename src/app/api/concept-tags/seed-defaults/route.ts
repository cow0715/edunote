import { getAuth, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { resetConceptDefaults } from '@/lib/services/concept-defaults'

export async function POST() {
  const { user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  try {
    return ok(await withTeacherTransaction(user.id, resetConceptDefaults))
  } catch (error) { return saveErrorResponse(error) }
}
