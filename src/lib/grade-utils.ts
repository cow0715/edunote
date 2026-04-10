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

// ── 공유 채점 헬퍼 ───────────────────────────────────────────────────────
// grade/route.ts, parse-answers/route.ts, questions/route.ts 가 공유.

// oxSelection: 'O' | 'X' | null, correctionText: 수정어만 (X 접두사 없음)
export function gradeOX(correctAnswerText: string, oxSelection: string | null, correctionText: string): boolean {
  const correct = correctAnswerText.trim()
  if (/^O$/i.test(correct)) return oxSelection === 'O'
  if (oxSelection !== 'X') return false
  let correction = correct.match(/\((.+)\)/)?.[1]?.trim().toLowerCase() ?? ''
  if (correction.includes('→')) correction = correction.split('→').pop()?.trim() ?? correction
  const student = correctionText.trim().toLowerCase()
  // '/' 구분자로 복수 정답 허용 (예: "in which / where")
  const alternatives = correction.split('/').map((s) => s.trim()).filter(Boolean)
  return alternatives.some((alt) => student === alt)
}

export function gradeMultiSelect(correctAnswerText: string, studentAnswerText: string): boolean {
  const normalize = (t: string) => t.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).sort().join(',')
  return normalize(correctAnswerText) === normalize(studentAnswerText)
}

// 학생 답안에서 수정어만 추출 ("e: watching", "watched → watching", "watching" 모두 → "watching")
export function extractCorrection(text: string): string {
  let s = text.trim()
  s = s.replace(/^[a-z]\s*:\s*/i, '')          // "e: watching" → "watching"
  s = s.replace(/^\([a-z]\)\s*:?\s*/i, '')      // "(e): watching" → "watching"
  if (s.includes('→')) s = s.split('→').pop()!   // "watched → watching" → "watching"
  return s.trim().toLowerCase()
}
