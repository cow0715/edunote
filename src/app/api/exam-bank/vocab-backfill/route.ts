import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import { syncExamQuestionVocabulary } from '@/lib/exam-vocabulary'
import { enrichExamQuestionVocabulary } from '@/lib/vocab-enrichment'

export const maxDuration = 300

type Action = 'scan' | 'parse' | 'enrich' | 'run'

type QuestionRow = {
  id: string
  question_type: string | null
  passage: string | null
  explanation_vocabulary: string | null
}

function readMonths(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return [6, 9, 11]
  return value.map(Number).filter((month) => Number.isFinite(month))
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const body = await request.json().catch(() => ({}))
  const action = (body.action ?? 'scan') as Action
  const currentYear = new Date().getFullYear()
  const yearTo = Number(body.year_to ?? currentYear - 1)
  const yearFrom = Number(body.year_from ?? yearTo - 4)
  const grade = Number(body.grade ?? 3)
  const months = readMonths(body.months)
  const limit = Math.min(Number(body.limit ?? 500), 1000)

  if (!['scan', 'parse', 'enrich', 'run'].includes(action)) return err('지원하지 않는 작업입니다')
  if (!Number.isFinite(yearFrom) || !Number.isFinite(yearTo) || yearFrom > yearTo) return err('연도 범위를 확인해주세요')
  if (!months.length) return err('월 범위를 확인해주세요')

  const { data: exams, error: examError } = await supabase
    .from('exam_bank')
    .select('id')
    .eq('teacher_id', teacherId)
    .eq('grade', grade)
    .gte('exam_year', yearFrom)
    .lte('exam_year', yearTo)
    .in('exam_month', months)

  if (examError) return err(examError.message, 500)
  const examIds = (exams ?? []).map((exam) => exam.id as string)
  if (examIds.length === 0) {
    return ok({ exams: 0, questions_with_words: 0, structured_questions: 0, missing_structured: 0, parsed: 0, enriched: null })
  }

  const { data: questionsRaw, error: questionError } = await supabase
    .from('exam_bank_question')
    .select('id, question_type, passage, explanation_vocabulary')
    .in('exam_bank_id', examIds)
    .not('explanation_vocabulary', 'is', null)
    .limit(limit)

  if (questionError) return err(questionError.message, 500)
  const questions = ((questionsRaw ?? []) as QuestionRow[]).filter((question) => question.explanation_vocabulary?.trim())
  const questionIds = questions.map((question) => question.id)

  const { data: existingRaw, error: existingError } = questionIds.length > 0
    ? await supabase
      .from('exam_bank_question_vocab')
      .select('question_id, normalized_word, synonyms, antonyms, similar_words')
      .in('question_id', questionIds)
    : { data: [], error: null }

  if (existingError) return err(existingError.message, 500)

  const structuredQuestionIds = new Set((existingRaw ?? []).map((row) => row.question_id as string))
  const missing = questions.filter((question) => !structuredQuestionIds.has(question.id))

  if (action === 'scan') {
    const uniqueWords = new Set((existingRaw ?? []).map((row) => row.normalized_word as string))
    const unenrichedWords = new Set(
      (existingRaw ?? [])
        .filter((row) => !(row.synonyms as string[] | null)?.length && !(row.antonyms as string[] | null)?.length && !(row.similar_words as string[] | null)?.length)
        .map((row) => row.normalized_word as string),
    )

    return ok({
      exams: examIds.length,
      questions_with_words: questions.length,
      structured_questions: structuredQuestionIds.size,
      missing_structured: missing.length,
      unique_words: uniqueWords.size,
      unenriched_words: unenrichedWords.size,
      parsed: 0,
      enriched: null,
    })
  }

  let parsed = 0
  const normalizedWords = new Set<string>()
  if (action === 'parse' || action === 'run') {
    for (const question of missing) {
      const result = await syncExamQuestionVocabulary(
        supabase,
        question.id,
        question.explanation_vocabulary,
        question.question_type,
        question.passage,
      )
      parsed += 1
      for (const word of result.normalizedWords) normalizedWords.add(word)
    }
  }

  if ((action === 'enrich' || action === 'run') && normalizedWords.size === 0) {
    for (const row of existingRaw ?? []) normalizedWords.add(row.normalized_word as string)
  }

  const enriched = (action === 'enrich' || action === 'run') && normalizedWords.size > 0
    ? await enrichExamQuestionVocabulary(supabase, { normalizedWords: [...normalizedWords], limit: 1000, batchSize: 40 })
    : null

  return ok({
    exams: examIds.length,
    questions_with_words: questions.length,
    structured_questions: structuredQuestionIds.size + parsed,
    missing_structured: Math.max(missing.length - parsed, 0),
    parsed,
    enriched,
  })
}
