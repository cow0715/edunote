import { getAuth, getTeacherId, assertClassOwner, err, ok } from '@/lib/api'

type WeekRow = {
  id: string
  class_id: string
  week_number: number
  start_date: string | null
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertClassOwner(supabase, classId, teacherId)) return err('접근 권한 없음', 403)

  const { data: weeks, error: weekError } = await supabase
    .from('week')
    .select('id, class_id, week_number, start_date')
    .eq('class_id', classId)
    .order('week_number')

  if (weekError) return err(weekError.message, 500)

  const weekRows = (weeks ?? []) as WeekRow[]
  const weekIds = weekRows.map((week) => week.id)
  const { data: words, error: wordError } = weekIds.length > 0
    ? await supabase
        .from('vocab_word')
        .select('id, week_id, number, passage_label, english_word, part_of_speech, correct_answer, synonyms, antonyms, derivatives, example_sentence, example_translation')
        .in('week_id', weekIds)
        .order('week_id')
        .order('number')
    : { data: [], error: null }

  if (wordError) return err(wordError.message, 500)
  return ok({ weeks: weekRows, words: words ?? [] })
}
