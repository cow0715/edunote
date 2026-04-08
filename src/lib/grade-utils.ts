import type { SupabaseServerClient } from '@/lib/api'

export async function recalcReadingCorrect(supabase: SupabaseServerClient, scoreIds: string[]) {
  await Promise.all(
    scoreIds.map(async (scoreId) => {
      const { data: answers } = await supabase
        .from('student_answer')
        .select('is_correct, exam_question(is_void)')
        .eq('week_score_id', scoreId)
      // void 문항 제외하고 집계
      const nonVoidAnswers = (answers ?? []).filter(
        (a) => !(a.exam_question as unknown as { is_void: boolean } | null)?.is_void
      )
      const readingCorrect =
        nonVoidAnswers.length > 0 ? nonVoidAnswers.filter((a) => a.is_correct).length : null
      await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', scoreId)
    })
  )
}
