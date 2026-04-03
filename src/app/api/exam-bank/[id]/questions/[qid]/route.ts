import { getAuth, getTeacherId, err, ok } from '@/lib/api'

// 소유권 확인 헬퍼
async function verifyOwner(
  supabase: Awaited<ReturnType<typeof getAuth>>['supabase'],
  teacherId: string,
  examId: string,
  qid: string,
) {
  const { data: exam } = await supabase
    .from('exam_bank')
    .select('id')
    .eq('id', examId)
    .eq('teacher_id', teacherId)
    .single()
  if (!exam) return null

  const { data: question } = await supabase
    .from('exam_bank_question')
    .select('id')
    .eq('id', qid)
    .eq('exam_bank_id', examId)
    .single()
  return question
}

// PATCH — 문항 수정
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; qid: string }> },
) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id, qid } = await params
  const question = await verifyOwner(supabase, teacherId, id, qid)
  if (!question) return err('문항을 찾을 수 없습니다', 404)

  const { question_number, question_type, passage, question_text, choices, answer } = await request.json()

  const { data, error } = await supabase
    .from('exam_bank_question')
    .update({
      question_number,
      question_type,
      passage: passage || '',
      question_text,
      choices: choices || [],
      answer: answer || '',
    })
    .eq('id', qid)
    .select()
    .single()

  if (error) return err(error.message)
  return ok(data)
}

// DELETE — 문항 단건 삭제
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; qid: string }> },
) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id, qid } = await params
  const question = await verifyOwner(supabase, teacherId, id, qid)
  if (!question) return err('문항을 찾을 수 없습니다', 404)

  const { error } = await supabase
    .from('exam_bank_question')
    .delete()
    .eq('id', qid)

  if (error) return err(error.message)
  return ok({ ok: true })
}
