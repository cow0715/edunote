import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { gradeVocabPhoto } from '@/lib/anthropic'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { studentId, fileData, mimeType } = await request.json()
  if (!fileData || !mimeType || !studentId) {
    return NextResponse.json({ error: '필수 파라미터 없음' }, { status: 400 })
  }

  // ── 1. AI 채점 ─────────────────────────────────────────────────────────
  let results
  try {
    results = await gradeVocabPhoto(fileData, mimeType)
  } catch (e) {
    console.error('[grade-vocab-photo] AI 채점 실패', e)
    return NextResponse.json({ error: '단어 채점 실패. 사진을 확인해주세요.' }, { status: 422 })
  }

  if (!results.length) {
    return NextResponse.json({ error: '단어를 찾을 수 없습니다' }, { status: 422 })
  }

  // ── 2. vocab_word upsert (같은 주차의 단어는 반 공유) ──────────────────
  const { data: vocabWords, error: vocabWordError } = await supabase
    .from('vocab_word')
    .upsert(
      results.map((r) => ({ week_id: weekId, number: r.number, english_word: r.english_word })),
      { onConflict: 'week_id,number' }
    )
    .select('id, number')

  if (vocabWordError) {
    console.error('[grade-vocab-photo] vocab_word upsert 실패', vocabWordError)
    return NextResponse.json({ error: vocabWordError.message }, { status: 500 })
  }

  // ── 3. week_score upsert ──────────────────────────────────────────────
  const vocabCorrect = results.filter((r) => r.is_correct).length
  const { data: score, error: scoreError } = await supabase
    .from('week_score')
    .upsert(
      { week_id: weekId, student_id: studentId, vocab_correct: vocabCorrect },
      { onConflict: 'week_id,student_id' }
    )
    .select('id')
    .single()

  if (scoreError || !score) {
    console.error('[grade-vocab-photo] week_score upsert 실패', scoreError)
    return NextResponse.json({ error: 'week_score 생성 실패' }, { status: 500 })
  }

  // ── 4. student_vocab_answer upsert ─────────────────────────────────────
  const vocabWordMap = new Map((vocabWords ?? []).map((w) => [w.number, w.id]))
  const answerInserts = results
    .map((r) => {
      const vocabWordId = vocabWordMap.get(r.number)
      if (!vocabWordId) return null
      return {
        week_score_id: score.id,
        vocab_word_id: vocabWordId,
        student_answer: r.student_answer || null,
        is_correct: r.is_correct,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (answerInserts.length > 0) {
    const { error: answerError } = await supabase
      .from('student_vocab_answer')
      .upsert(answerInserts, { onConflict: 'week_score_id,vocab_word_id' })
    if (answerError) console.error('[grade-vocab-photo] student_vocab_answer upsert 실패', answerError)
  }

  // ── 5. week.vocab_total 자동 업데이트 ────────────────────────────────
  await supabase.from('week').update({ vocab_total: results.length }).eq('id', weekId)

  return NextResponse.json({ ok: true, vocab_correct: vocabCorrect, vocab_total: results.length, results })
}
