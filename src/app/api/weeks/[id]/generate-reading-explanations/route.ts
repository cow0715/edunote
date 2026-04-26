import { assertWeekOwner, getAuth, getTeacherId, err, ok } from '@/lib/api'
import { generateExplanations } from '@/lib/anthropic'

export const maxDuration = 300

type QuestionForGeneration = {
  id: string
  question_number: number
  question_style: string
  correct_answer: number
  correct_answer_text: string | null
  question_text: string | null
}

function splitStoredQuestionText(raw: string | null): {
  passage: string
  questionText: string
  choices: string[]
} {
  const lines = (raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const choices: string[] = []
  while (lines.length > 0 && /^\d+\.\s+/.test(lines[lines.length - 1])) {
    const line = lines.pop()!
    choices.unshift(line.replace(/^\d+\.\s+/, '').trim())
  }

  return {
    passage: '',
    questionText: lines.join('\n'),
    choices,
  }
}

function buildAnswerLabel(question: QuestionForGeneration, choices: string[]): string {
  if (question.question_style === 'objective' && question.correct_answer > 0) {
    const choiceText = choices[question.correct_answer - 1]
    return choiceText ? `${question.correct_answer}. ${choiceText}` : String(question.correct_answer)
  }

  return question.correct_answer_text ?? ''
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await getAuth()
    const { id: weekId } = await params
    if (!user) return err('인증이 필요합니다.', 401)

    const teacherId = await getTeacherId(supabase, user.id)
    if (!teacherId) return err('강사 정보를 찾지 못했습니다.', 404)
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한이 없습니다.', 403)

    const body = await request.json().catch(() => ({}))
    const force = body?.force === true

    const { data: questions, error } = await supabase
      .from('exam_question')
      .select('id, question_number, question_style, correct_answer, correct_answer_text, question_text, explanation')
      .eq('week_id', weekId)
      .eq('exam_type', 'reading')
      .order('question_number')
      .order('sub_label', { nullsFirst: true })

    if (error) return err(error.message, 500)

    const targets = (questions ?? []).filter((question) => {
      if (force) return true
      return !question.explanation?.trim()
    })

    if (targets.length === 0) {
      return ok({ ok: true, generated_count: 0 })
    }

    const chunkSize = 6
    const chunks: QuestionForGeneration[][] = []
    for (let i = 0; i < targets.length; i += chunkSize) {
      chunks.push(targets.slice(i, i + chunkSize))
    }

    const generatedMap = new Map<string, string>()
    for (const chunk of chunks) {
      const explanationInputs = chunk.map((question) => {
        const { passage, questionText, choices } = splitStoredQuestionText(question.question_text)
        return {
          id: question.id,
          question_number: question.question_number,
          passage,
          question_text: questionText,
          choices,
          answer: buildAnswerLabel(question, choices),
        }
      })

      const generated = await generateExplanations(
        explanationInputs.map((item) => ({
          question_number: item.question_number,
          passage: item.passage,
          question_text: item.question_text,
          choices: item.choices,
          answer: item.answer,
        })),
        'standard',
      )

      for (const item of explanationInputs) {
        const matched = generated.find((result) => result.question_number === item.question_number)
        const explanation = matched?.solution || matched?.translation || matched?.intent || ''
        if (explanation) {
          generatedMap.set(item.id, explanation)
        }
      }

      const chunkUpdates = explanationInputs
        .map((item) => {
          const explanation = generatedMap.get(item.id)
          return explanation ? { id: item.id, explanation } : null
        })
        .filter((item): item is { id: string; explanation: string } => item !== null)

      for (const update of chunkUpdates) {
        await supabase.from('exam_question').update({ explanation: update.explanation }).eq('id', update.id)
      }
    }

    return ok({
      ok: true,
      generated_count: generatedMap.size,
    })
  } catch (error) {
    console.error('[generate-reading-explanations] unhandled error:', error)
    const message = error instanceof Error ? error.message : 'AI 해설 생성 실패'
    return err(`AI 해설 생성 실패: ${message}`, 500)
  }
}
