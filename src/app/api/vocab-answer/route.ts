import { getAuth, err, ok } from '@/lib/api'
import { gradeVocabItems } from '@/lib/anthropic'

export const maxDuration = 60

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { id, week_score_id, student_answer, is_correct, teacher_locked } = await request.json()
  if (!id) return err('id 필요')

  const { error } = await supabase
    .from('student_vocab_answer')
    .update({
      student_answer: student_answer ?? null,
      is_correct,
      ...(teacher_locked !== undefined && { teacher_locked }),
    })
    .eq('id', id)

  if (error) return err(error.message, 500)

  // vocab_correct 재계산
  if (week_score_id) {
    const { data: all } = await supabase
      .from('student_vocab_answer')
      .select('is_correct')
      .eq('week_score_id', week_score_id)
    const vocabCorrect = (all ?? []).filter((a) => a.is_correct).length
    await supabase.from('week_score').update({ vocab_correct: vocabCorrect }).eq('id', week_score_id)
  }

  return ok({ ok: true })
}

// 수정된 답안 재채점 — items: { id, number, english_word, student_answer }[]
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { weekScoreId, items } = await request.json() as {
    weekScoreId: string
    items: { id: string; number: number; english_word: string; student_answer: string | null }[]
  }
  if (!items?.length) return err('items 필요')

  const graded = await gradeVocabItems(items)

  // DB 업데이트
  await Promise.all(graded.map((g) => {
    const orig = items.find((i) => i.number === g.number)
    if (!orig) return
    return supabase
      .from('student_vocab_answer')
      .update({ student_answer: g.student_answer ?? null, is_correct: g.is_correct })
      .eq('id', orig.id)
  }))

  // vocab_correct 재계산
  if (weekScoreId) {
    const { data: all } = await supabase
      .from('student_vocab_answer')
      .select('is_correct')
      .eq('week_score_id', weekScoreId)
    const vocabCorrect = (all ?? []).filter((a) => a.is_correct).length
    await supabase.from('week_score').update({ vocab_correct: vocabCorrect }).eq('id', weekScoreId)
  }

  return ok({ ok: true, results: graded })
}
