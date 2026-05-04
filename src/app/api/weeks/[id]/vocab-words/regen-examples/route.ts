import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { generateVocabExamples } from '@/lib/anthropic'

export const maxDuration = 60

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const { data: missing, error } = await supabase
    .from('vocab_word')
    .select('id, english_word')
    .eq('week_id', weekId)
    .is('example_sentence', null)

  if (error) return err(error.message, 500)
  if (!missing?.length) return ok({ generated: 0 })

  const examples = await generateVocabExamples(missing)

  const updates = await Promise.all(
    examples.map((u) =>
      supabase
        .from('vocab_word')
        .update({ example_sentence: u.sentence, example_translation: u.translation, example_source: 'teacher_ai' })
        .eq('id', u.id)
    )
  )
  const saved = updates.filter((r) => !r.error).length

  if (saved > 0) {
    await supabase
      .from('week')
      .update({ vocab_examples_generated_at: new Date().toISOString() })
      .eq('id', weekId)
  }

  return ok({ generated: examples.length, saved, missing: missing.length })
}
