/**
 * 진단평가 문항의 빈 해설을 AI 로 채운다 (원본 우선 — 이미 해설이 있는 문항은 절대 덮어쓰지 않음).
 *
 * 해설지형은 파싱 프롬프트가 해설을 같이 뽑아오므로 대부분 0건이고,
 * 문제지형은 정오표 반영 직후 이 함수가 전 문항을 채운다. 생성된 건 explanation_source='ai' 로 표시.
 * 6문항씩 묶어 동시 2개 배치로 돌리고, 배치 하나가 실패해도 나머지는 저장한다.
 */

import type { SupabaseServerClient } from '@/lib/api'
import { generateExplanations } from '@/lib/anthropic'
import { getStructuredQuestionParts } from '@/lib/question-structure'
import { mapWithConcurrency } from '@/lib/concurrency'

const BATCH_SIZE = 6
const BATCH_CONCURRENCY = 2

type QuestionRow = {
  id: string
  question_number: number
  question_style: string
  correct_answer: number
  correct_answer_text: string | null
  question_text: string | null
  question_stem: string | null
  passage: string | null
  choices: string[] | null
  explanation: string | null
}

function buildAnswerLabel(question: QuestionRow, choices: string[]): string {
  if (question.question_style === 'objective' && question.correct_answer > 0) {
    const choiceText = choices[question.correct_answer - 1]
    return choiceText ? `${question.correct_answer}. ${choiceText}` : String(question.correct_answer)
  }
  return question.correct_answer_text ?? ''
}

export async function generateMissingReadingExplanations(
  supabase: SupabaseServerClient,
  weekId: string,
): Promise<{ generated: number; targets: number; failedBatches: number }> {
  const { data, error } = await supabase
    .from('exam_question')
    .select('id, question_number, question_style, correct_answer, correct_answer_text, question_text, question_stem, passage, choices, explanation')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')
    .order('sub_label', { nullsFirst: true })
  if (error) throw new Error(error.message)

  const targets = ((data ?? []) as QuestionRow[]).filter((q) => !q.explanation?.trim())
  if (targets.length === 0) return { generated: 0, targets: 0, failedBatches: 0 }

  const batches: QuestionRow[][] = []
  for (let i = 0; i < targets.length; i += BATCH_SIZE) batches.push(targets.slice(i, i + BATCH_SIZE))

  let generated = 0
  let failedBatches = 0

  await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batch) => {
    const inputs = batch.map((question) => {
      const structured = getStructuredQuestionParts(question)
      return {
        id: question.id,
        question_number: question.question_number,
        passage: structured.passage,
        question_text: structured.questionStem,
        choices: structured.choices,
        answer: buildAnswerLabel(question, structured.choices),
      }
    })

    let results: Awaited<ReturnType<typeof generateExplanations>>
    try {
      results = await generateExplanations(inputs, 'standard')
    } catch (e) {
      // 배치 실패는 삼킨다 — 해설은 부가 정보라 정답 반영을 막으면 안 됨
      console.error('[reading-explanations] 배치 실패:', e instanceof Error ? e.message : e)
      failedBatches += 1
      return
    }

    for (const item of inputs) {
      const matched = results.find((r) => r.question_number === item.question_number)
      const explanation = matched?.solution || matched?.translation || matched?.intent || ''
      if (!explanation) continue
      const { error: updateErr } = await supabase
        .from('exam_question')
        .update({ explanation, explanation_source: 'ai' })
        .eq('id', item.id)
      if (!updateErr) generated += 1
    }
  })

  console.log(`[reading-explanations] week ${weekId}: 대상 ${targets.length} → 생성 ${generated} (실패 배치 ${failedBatches})`)
  return { generated, targets: targets.length, failedBatches }
}
