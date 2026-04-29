import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { syncExamQuestionVocabulary } from '@/lib/exam-vocabulary'
import { enrichExamQuestionVocabulary } from '@/lib/vocab-enrichment'

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
    .select('id, question_type, passage')
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

  const body = await request.json()
  const {
    question_number, question_type, passage, question_text, choices, answer,
    explanation_intent, explanation_translation, explanation_solution, explanation_vocabulary,
  } = body

  // 해설만 업데이트하는 경우 (explanation_* 키 중 하나라도 있으면)
  const isExplanationUpdate = 'explanation_intent' in body || 'explanation_solution' in body

  const updateData = isExplanationUpdate
    ? {
        explanation_intent: explanation_intent ?? null,
        explanation_translation: explanation_translation ?? null,
        explanation_solution: explanation_solution ?? null,
        explanation_vocabulary: explanation_vocabulary ?? null,
      }
    : {
        question_number,
        question_type,
        passage: passage || '',
        question_text,
        choices: choices || [],
        answer: answer || '',
      }

  const { data, error } = await supabase
    .from('exam_bank_question')
    .update(updateData)
    .eq('id', qid)
    .select()
    .single()

  if (error) return err(error.message)
  if (isExplanationUpdate) {
    const synced = await syncExamQuestionVocabulary(
      supabase,
      qid,
      explanation_vocabulary,
      data.question_type ?? question.question_type,
      data.passage ?? question.passage,
    )
    if (synced.normalizedWords.length > 0) {
      await enrichExamQuestionVocabulary(supabase, { normalizedWords: synced.normalizedWords, limit: 120, batchSize: 40 })
    }
  }
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
