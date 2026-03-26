import type { SupabaseServerClient } from '@/lib/api'

export async function recalcReadingCorrect(supabase: SupabaseServerClient, scoreIds: string[]) {
  await Promise.all(
    scoreIds.map(async (scoreId) => {
      const { data: answers } = await supabase
        .from('student_answer')
        .select('is_correct')
        .eq('week_score_id', scoreId)
      const readingCorrect =
        answers && answers.length > 0 ? answers.filter((a) => a.is_correct).length : null
      await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', scoreId)
    })
  )
}
