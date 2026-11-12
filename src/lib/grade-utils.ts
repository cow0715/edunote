import type { SupabaseServerClient } from '@/lib/api'
import { normalizeErrorSymbol } from '@/lib/find-error-grading'

export async function recalcReadingCorrect(supabase: SupabaseServerClient, scoreIds: string[]) {
  if (!scoreIds.length) return
  const { error } = await supabase.rpc('recalculate_reading_scores', { p_score_ids: [...new Set(scoreIds)] })
  if (error) throw new Error('점수 재계산에 실패했습니다. 기존 점수는 유지됩니다.')
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
