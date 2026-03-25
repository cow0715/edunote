import { getAuth, err, ok } from '@/lib/api'
import { gradeVocabPhoto } from '@/lib/anthropic'

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { studentId, fileData, mimeType } = await request.json()
  if (!fileData || !mimeType || !studentId) {
    return err('필수 파라미터 없음')
  }

  // ── 1. AI 채점 ─────────────────────────────────────────────────────────
  let results
  try {
    results = await gradeVocabPhoto(fileData, mimeType)
  } catch (e) {
    console.error('[grade-vocab-photo] AI 채점 실패', e)
    return err('단어 채점 실패. 사진을 확인해주세요.', 422)
  }

  if (!results.length) {
    return err('단어를 찾을 수 없습니다', 422)
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
    return err(vocabWordError.message, 500)
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
    return err('week_score 생성 실패', 500)
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

  // ── 6. 사진 Storage 업로드 (채점과 독립적으로 처리) ───────────────────
  try {
    const ext = mimeType.includes('png') ? 'png' : 'jpg'
    const storagePath = `${weekId}/${studentId}.${ext}`
    const buffer = Buffer.from(fileData, 'base64')
    const { error: uploadError } = await supabase.storage
      .from('vocab-photos')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true })
    if (!uploadError) {
      await supabase.from('week_score').update({ vocab_photo_path: storagePath }).eq('id', score.id)
    } else {
      console.error('[grade-vocab-photo] 사진 업로드 실패', uploadError)
    }
  } catch (e) {
    console.error('[grade-vocab-photo] 사진 업로드 예외', e)
  }

  return ok({ ok: true, vocab_correct: vocabCorrect, vocab_total: results.length, results })
}
