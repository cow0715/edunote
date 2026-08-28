import type { SupabaseServerClient } from '@/lib/api'
import { normalizeErrorSymbol } from '@/lib/find-error-grading'

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

// ── 공유 채점 헬퍼 ───────────────────────────────────────────────────────
// grade/route.ts, parse-answers/route.ts, questions/route.ts 가 공유.
// OX 판정은 UI 도 같이 쓰므로 @/lib/ox-grading 으로 분리했다.

export function gradeMultiSelect(correctAnswerText: string, studentAnswerText: string): boolean {
  // ①→1, ⓐ→a, (b)→b, A→a — 학생·OCR 이 어떤 표기로 적든 정답키("1,3" / "a,b,e")와 맞춘다
  const normalize = (t: string) => t
    .split(',')
    .map((s) => {
      const token = s.trim()
      return normalizeErrorSymbol(token) ?? token.toLowerCase()
    })
    .filter(Boolean)
    .sort()
    .join(',')
  return normalize(correctAnswerText) === normalize(studentAnswerText)
}
