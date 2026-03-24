import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { gradeVocabItems } from '@/lib/anthropic'

export const maxDuration = 60

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { id, student_answer, is_correct } = await request.json()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const { error } = await supabase
    .from('student_vocab_answer')
    .update({ student_answer: student_answer ?? null, is_correct })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// 수정된 답안 재채점 — items: { id, number, english_word, student_answer }[]
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { weekScoreId, items } = await request.json() as {
    weekScoreId: string
    items: { id: string; number: number; english_word: string; student_answer: string | null }[]
  }
  if (!items?.length) return NextResponse.json({ error: 'items 필요' }, { status: 400 })

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

  return NextResponse.json({ ok: true, results: graded })
}
