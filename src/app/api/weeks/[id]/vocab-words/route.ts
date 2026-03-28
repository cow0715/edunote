import { getAuth, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { data, error } = await supabase
    .from('vocab_word')
    .select('number, english_word, correct_answer, synonyms, antonyms')
    .eq('week_id', weekId)
    .order('number')

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { words } = await request.json()
  if (!words?.length) return err('단어 없음')

  const { error } = await supabase
    .from('vocab_word')
    .upsert(
      words.map((w: { number: number; english_word: string; correct_answer: string | null; synonyms: string[]; antonyms: string[] }) => ({
        week_id: weekId,
        number: w.number,
        english_word: w.english_word,
        correct_answer: w.correct_answer ?? null,
        synonyms: w.synonyms ?? [],
        antonyms: w.antonyms ?? [],
      })),
      { onConflict: 'week_id,number' }
    )

  if (error) {
    console.error('[vocab-words] upsert 실패', error)
    return err(error.message, 500)
  }

  // vocab_total 자동 업데이트
  await supabase
    .from('week')
    .update({ vocab_total: words.length })
    .eq('id', weekId)

  return ok({ ok: true, saved: words.length })
}
