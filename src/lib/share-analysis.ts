import type { StudentAnswer, Week } from '@/app/share/[token]/share-types'
import { SMALL_SAMPLE_MAX, sortByWeakness, type WrongTypeStat } from './wrong-rate'

export type AnalysisPoint = {
  weekId: string
  correct: number
  total: number
  rate: number
}
export type AnalysisType = WrongTypeStat & { points: AnalysisPoint[] }

/** Only supplied-period reading answers are counted. A type is counted once per answer. */
export function buildShareAnalysis(answers: StudentAnswer[], weeks: Week[]) {
  const weekIds = new Set(weeks.map((week) => week.id))
  const reading = answers.filter((answer) => answer.exam_question?.exam_type === 'reading'
    && weekIds.has(answer.exam_question.week_id))
  const orderedWeeks = [...weeks].sort((a, b) =>
    (a.start_date ?? '').localeCompare(b.start_date ?? '') || a.week_number - b.week_number || a.id.localeCompare(b.id))
  const byType = new Map<string, WrongTypeStat & { byWeek: Map<string, AnalysisPoint> }>()
  let untaggedCount = 0
  for (const answer of reading) {
    const question = answer.exam_question!
    const seen = new Set<string>()
    for (const { concept_tag: tag } of question.exam_question_tag) {
      if (!tag || seen.has(tag.id)) continue
      seen.add(tag.id)
      const stat = byType.get(tag.id) ?? { id: tag.id, name: tag.name, wrong: 0, total: 0, byWeek: new Map<string, AnalysisPoint>() }
      stat.total++
      if (!answer.is_correct) stat.wrong++
      const point = stat.byWeek.get(question.week_id) ?? { weekId: question.week_id, correct: 0, total: 0, rate: 0 }
      point.total++
      if (answer.is_correct) point.correct++
      point.rate = Math.round(point.correct / point.total * 100)
      stat.byWeek.set(question.week_id, point)
      byType.set(tag.id, stat)
    }
    if (seen.size === 0) untaggedCount++
  }
  const types: AnalysisType[] = sortByWeakness([...byType.values()]).map(({ byWeek, ...stat }) => ({
    ...stat,
    points: orderedWeeks.flatMap((week) => byWeek.has(week.id) ? [byWeek.get(week.id)!] : []),
  }))
  const wrongCount = reading.filter((answer) => !answer.is_correct).length
  const focus = types.find((type) => type.wrong > 0 && type.total > SMALL_SAMPLE_MAX)
    ?? types.find((type) => type.wrong > 0) ?? null
  const headline = focus
    ? `${focus.name},\n함께 짚어볼까요?`
    : wrongCount > 0 ? '틀린 문제를\n함께 짚어볼까요?'
      : reading.length > 0 ? '확인된 문제를\n모두 맞혔어요.' : '학습 기록이 쌓이면\n함께 살펴봐요.'
  const description = focus
    ? focus.total <= SMALL_SAMPLE_MAX
      ? '아직 출제 수가 적어요. 틀린 문제부터 가볍게 확인해요.'
      : '어디서 헷갈렸는지, 틀린 문제부터 확인해요.'
    : wrongCount > 0 ? '문제별 해설에서 놓친 근거를 확인해 보세요.'
      : reading.length > 0 ? '이 기간에 확인된 문항별 결과예요.'
        : '문항별 결과가 등록되면 유형과 변화를 보여드릴게요.'
  return {
    types, focus, headline, description, wrongCount, untaggedCount,
    readingCount: reading.length,
    weekCount: new Set(reading.map((answer) => answer.exam_question!.week_id)).size,
    // Compare actual appearances, not consecutive calendar weeks. Never invent a zero for a missing exam.
    trends: types.filter((type) => type.points.length >= 2),
  }
}
