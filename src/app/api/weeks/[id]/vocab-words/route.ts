import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { words } = await request.json()
  if (!words?.length) return NextResponse.json({ error: '단어 없음' }, { status: 400 })

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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, saved: words.length })
}
