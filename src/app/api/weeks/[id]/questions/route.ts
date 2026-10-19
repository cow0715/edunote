import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { editQuestions } from '@/lib/services/questions'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const { data, error } = await supabase
    .from('exam_question')
    .select('*, exam_question_tag(concept_tag(*, concept_category(*))), exam_question_choice(*)')
    .eq('week_id', weekId)
    .order('question_number')
    .order('sub_label', { nullsFirst: true })

  if (error) {
    console.error('[GET /api/weeks/[id]/questions]', error)
    return err(error.message, 500)
  }

  return ok(data)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await getAuth()
  if (!user) return err('인증 필요',401)
  try {
    const { id } = await params
    const body: unknown = await request.json()
    return ok(await withTeacherTransaction(user.id,context=>editQuestions(context,id,body)))
  } catch (error) { return saveErrorResponse(error) }
}
