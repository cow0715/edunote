import { getAuth, getTeacherId, assertWeekOwner, err, ok, SupabaseServerClient } from '@/lib/api'
import { gradeVocabItems } from '@/lib/anthropic'

export const maxDuration = 60

type AnswerOwnerRow = {
  id: string
  week_score_id: string
  week_score: { week_id: string } | { week_id: string }[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

async function getOwnedAnswerRows(supabase: SupabaseServerClient, authId: string, answerIds: string[]) {
  const teacherId = await getTeacherId(supabase, authId)
  if (!teacherId) return { error: err('강사 정보 없음', 404) }

  const { data, error } = await supabase
    .from('student_vocab_answer')
    .select('id, week_score_id, week_score(week_id)')
    .in('id', answerIds)

  if (error) return { error: err(error.message, 500) }
  const rows = (data ?? []) as unknown as AnswerOwnerRow[]
  if (rows.length !== answerIds.length) return { error: err('답안을 찾을 수 없습니다', 404) }

  const weekIds = [...new Set(rows.map((row) => one(row.week_score)?.week_id).filter((id): id is string => !!id))]
  if (weekIds.length === 0) return { error: err('답안 주차를 찾을 수 없습니다', 404) }
  for (const weekId of weekIds) {
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return { error: err('접근 권한 없음', 403) }
  }

  return { rows }
}

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { id, week_score_id, student_answer, is_correct, teacher_locked } = await request.json()
  if (!id) return err('id 필요')
  const owned = await getOwnedAnswerRows(supabase, user.id, [id])
  if ('error' in owned) return owned.error
  const actualWeekScoreId = owned.rows[0]?.week_score_id

  const { error } = await supabase
    .from('student_vocab_answer')
    .update({
      student_answer: student_answer ?? null,
      is_correct,
      ...(teacher_locked !== undefined && { teacher_locked }),
    })
    .eq('id', id)

  if (error) return err(error.message, 500)

  // vocab_correct 재계산 (빈 문자열 방어)
  if (actualWeekScoreId || week_score_id) {
    const { data: all } = await supabase
      .from('student_vocab_answer')
      .select('is_correct')
      .eq('week_score_id', actualWeekScoreId ?? week_score_id)
    const vocabCorrect = (all ?? []).filter((a) => a.is_correct).length
    await supabase.from('week_score').update({ vocab_correct: vocabCorrect }).eq('id', actualWeekScoreId ?? week_score_id)
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
  const owned = await getOwnedAnswerRows(supabase, user.id, items.map((i) => i.id))
  if ('error' in owned) return owned.error
  const actualWeekScoreId = owned.rows[0]?.week_score_id

  // correct_answer 조회 (student_vocab_answer → vocab_word)
  const { data: answerDetails } = await supabase
    .from('student_vocab_answer')
    .select('id, vocab_word(correct_answer), vocab_word_variant(meaning)')
    .in('id', items.map((i) => i.id))

  const correctAnswerById = new Map(
    (answerDetails ?? []).map((a) => {
      const vw = a.vocab_word as unknown as { correct_answer: string | null } | null
      const variant = a.vocab_word_variant as unknown as { meaning: string | null } | null
      return [a.id, variant?.meaning ?? vw?.correct_answer ?? null]
    })
  )

  const itemsWithAnswer = items.map((i) => ({
    ...i,
    correct_answer: correctAnswerById.get(i.id) ?? null,
  }))

  const { data: promptRow } = await supabase.from('prompts').select('content').eq('key', 'vocab_grading_rules').maybeSingle()
  const customRules = promptRow?.content ?? undefined

  const graded = await gradeVocabItems(itemsWithAnswer, customRules)

  // DB 업데이트 (재채점 완료 → teacher_locked: false 해제)
  await Promise.all(graded.map((g) => {
    const orig = items.find((i) => i.number === g.number)
    if (!orig) return
    return supabase
      .from('student_vocab_answer')
      .update({ student_answer: g.student_answer ?? null, is_correct: g.is_correct, teacher_locked: false })
      .eq('id', orig.id)
  }))

  // vocab_correct 재계산 (weekScoreId 빈 문자열 방어)
  if (actualWeekScoreId || weekScoreId) {
    const { data: all } = await supabase
      .from('student_vocab_answer')
      .select('is_correct')
      .eq('week_score_id', actualWeekScoreId ?? weekScoreId)
    const vocabCorrect = (all ?? []).filter((a) => a.is_correct).length
    await supabase.from('week_score').update({ vocab_correct: vocabCorrect }).eq('id', actualWeekScoreId ?? weekScoreId)
  }

  return ok({ ok: true, results: graded })
}
