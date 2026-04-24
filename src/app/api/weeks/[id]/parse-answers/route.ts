import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import {
  parseAnswerSheet,
  parseWeekProblemSheetPage,
  parseProblemSheetAnswerKey,
  generateExplanations,
  gradeSubjectiveAnswers,
} from '@/lib/anthropic'
import type { SubjectiveStudentAnswer, TagCategory, ParsedAnswer } from '@/lib/anthropic'
import { gradeOX, gradeMultiSelect } from '@/lib/grade-utils'

export const maxDuration = 300

type ParseMode = 'auto' | 'answer_sheet' | 'problem_sheet'
type UsedParseMode = 'answer_sheet' | 'problem_sheet'

function normalizeParsedAnswers(parsedAnswers: ParsedAnswer[]): ParsedAnswer[] {
  const grouped = new Map<number, ParsedAnswer[]>()
  for (const answer of parsedAnswers) {
    const arr = grouped.get(answer.question_number) ?? []
    arr.push(answer)
    grouped.set(answer.question_number, arr)
  }

  const normalized: ParsedAnswer[] = []
  for (const [, group] of grouped) {
    const hasFindError = group.some((g) => g.question_style === 'find_error')
    if (group.length === 1 || hasFindError) {
      normalized.push(...group)
      continue
    }

    const sorted = [...group].sort((x, y) => (x.sub_label ?? '').localeCompare(y.sub_label ?? ''))
    const alphabet = 'abcdefghijklmnopqrstuvwxyz'
    sorted.forEach((item, index) => {
      normalized.push({ ...item, sub_label: alphabet[index] })
    })
  }

  return normalized
}

function buildStoredQuestionText(question: {
  question_text: string
  passage: string
  choices: string[]
}): string | null {
  const parts: string[] = []
  const stem = question.question_text.trim()
  const passage = question.passage.trim()

  if (stem) parts.push(stem)
  if (passage) parts.push(passage)
  if (question.choices.length > 0) {
    parts.push(question.choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n'))
  }

  return parts.length > 0 ? parts.join('\n') : null
}

function buildExplanationAnswer(question: {
  choices: string[]
}, answer: {
  question_style: ParsedAnswer['question_style']
  correct_answer: number
  correct_answer_text: string | null
}): string {
  if (answer.question_style === 'objective' && answer.correct_answer > 0) {
    const choiceText = question.choices[answer.correct_answer - 1]
    return choiceText ? `${answer.correct_answer}. ${choiceText}` : String(answer.correct_answer)
  }
  return answer.correct_answer_text ?? ''
}

async function extractPdfText(fileData: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const buffer = Buffer.from(fileData, 'base64')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return String(text || '')
}

async function parseProblemSheetAnswers(
  fileData: string,
  mimeType: string,
): Promise<ParsedAnswer[]> {
  if (mimeType !== 'application/pdf') {
    throw new Error('문제지형 파싱은 현재 PDF만 지원합니다.')
  }

  const questions = await parseWeekProblemSheetPage(fileData, mimeType)
  if (!questions.length) {
    throw new Error('문제지에서 문항을 찾지 못했습니다.')
  }

  const rawText = await extractPdfText(fileData)
  if (!rawText.trim()) {
    throw new Error('문제지 PDF에서 텍스트를 추출하지 못했습니다.')
  }

  const answerKey = await parseProblemSheetAnswerKey(rawText, questions)
  if (!answerKey.length) {
    throw new Error('문제지 PDF에서 정답 표기를 찾지 못했습니다.')
  }

  const answerMap = new Map(answerKey.map((item) => [item.question_number, item]))
  const merged = questions
    .filter((question) => answerMap.has(question.question_number))
    .map((question) => ({ question, answer: answerMap.get(question.question_number)! }))

  if (!merged.length) {
    throw new Error('문항과 정답을 매칭하지 못했습니다.')
  }

  let explanations = new Map<number, string>()
  try {
    const generated = await generateExplanations(
      merged.map(({ question, answer }) => ({
        question_number: question.question_number,
        passage: question.passage,
        question_text: question.question_text,
        choices: question.choices,
        answer: buildExplanationAnswer(question, answer),
      })),
      'full',
    )
    explanations = new Map(
      generated.map((item) => [item.question_number, item.solution || item.translation || item.intent || '']),
    )
  } catch (e) {
    console.error('[parse-answers] problem_sheet explanation generation failed:', e)
  }

  return merged.map(({ question, answer }) => ({
    question_number: question.question_number,
    sub_label: null,
    question_style: answer.question_style ?? question.question_style,
    question_type: question.question_type,
    correct_answer: answer.correct_answer,
    correct_answer_text: answer.correct_answer_text,
    grading_criteria: null,
    explanation: explanations.get(question.question_number) || null,
    question_text: buildStoredQuestionText(question),
  }))
}

async function parseAnswersWithMode(
  fileData: string,
  mimeType: string,
  tagCategories: TagCategory[],
  requestedMode: ParseMode,
): Promise<{ parsedAnswers: ParsedAnswer[]; usedMode: UsedParseMode }> {
  if (requestedMode === 'answer_sheet') {
    console.log('[parse-answers] requested mode: answer_sheet')
    const parsedAnswers = await parseAnswerSheet(fileData, mimeType, tagCategories)
    if (!parsedAnswers.length) throw new Error('해설 포함 PDF로 파싱하지 못했습니다.')
    return { parsedAnswers, usedMode: 'answer_sheet' }
  }

  if (requestedMode === 'problem_sheet') {
    console.log('[parse-answers] requested mode: problem_sheet')
    const parsedAnswers = await parseProblemSheetAnswers(fileData, mimeType)
    if (!parsedAnswers.length) throw new Error('문제지형 PDF에서 문항/정답 추출에 실패했습니다.')
    return { parsedAnswers, usedMode: 'problem_sheet' }
  }

  console.log('[parse-answers] requested mode: auto')
  try {
    const parsedAnswers = await parseAnswerSheet(fileData, mimeType, tagCategories)
    if (parsedAnswers.length > 0) {
      console.log('[parse-answers] used mode: answer_sheet')
      return { parsedAnswers, usedMode: 'answer_sheet' }
    }
    console.warn('[parse-answers] primary parse returned empty result')
  } catch (e) {
    console.error('[parse-answers] primary failure:', e)
  }

  if (mimeType === 'application/pdf') {
    try {
      const parsedAnswers = await parseProblemSheetAnswers(fileData, mimeType)
      if (parsedAnswers.length > 0) {
        console.log('[parse-answers] used mode: problem_sheet')
        return { parsedAnswers, usedMode: 'problem_sheet' }
      }
    } catch (e) {
      console.error('[parse-answers] fallback failure:', e)
    }
  }

  throw new Error('자동 판별에 실패했습니다. 형식을 지정해 다시 시도해주세요.')
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증이 필요합니다.', 401)

  const teacherId = await getTeacherId(supabase, user.id)

  const tagList: { id: string; name: string }[] = []
  const tagCategories: TagCategory[] = []

  if (teacherId) {
    const { data: categories } = await supabase
      .from('concept_category')
      .select('id, name')
      .eq('teacher_id', teacherId)
      .order('sort_order')

    const { data: tags } = await supabase
      .from('concept_tag')
      .select('id, name, concept_category_id')
      .eq('teacher_id', teacherId)
      .order('sort_order')

    for (const tag of tags ?? []) tagList.push(tag)

    for (const category of categories ?? []) {
      const categoryTags = (tags ?? [])
        .filter((tag) => tag.concept_category_id === category.id)
        .map((tag) => tag.name)
      if (categoryTags.length > 0) tagCategories.push({ categoryName: category.name, tags: categoryTags })
    }
  }

  function matchTagId(questionType: string | null): string | null {
    if (!questionType) return null
    const exact = tagList.find((tag) => tag.name === questionType)
    if (exact) return exact.id
    const normalizedQuestionType = questionType.replace(/\s/g, '').toLowerCase()
    const normalizedTag = tagList.find((tag) => tag.name.replace(/\s/g, '').toLowerCase() === normalizedQuestionType)
    return normalizedTag?.id ?? null
  }

  const body = await request.json()
  const { fileData, mimeType, fileName } = body
  const requestedMode = (body.parseMode === 'answer_sheet' || body.parseMode === 'problem_sheet' || body.parseMode === 'auto'
    ? body.parseMode
    : 'auto') as ParseMode
  if (!fileData || !mimeType) return err('파일이 없습니다.')

  let parsedAnswers: ParsedAnswer[]
  let usedMode: UsedParseMode
  try {
    const result = await parseAnswersWithMode(fileData, mimeType, tagCategories, requestedMode)
    parsedAnswers = normalizeParsedAnswers(result.parsedAnswers)
    usedMode = result.usedMode
  } catch (e) {
    const message = e instanceof Error ? e.message : '파싱에 실패했습니다.'
    if (requestedMode === 'answer_sheet') return err(message || '해설 포함 PDF로 파싱하지 못했습니다.', 422)
    if (requestedMode === 'problem_sheet') return err(message || '문제지형 PDF에서 문항/정답 추출에 실패했습니다.', 422)
    return err(message || '자동 판별에 실패했습니다. 형식을 지정해 다시 시도해주세요.', 422)
  }

  if (!parsedAnswers.length) {
    return err('문항을 찾을 수 없습니다.', 422)
  }

  try {
    const safeName = (fileName as string | undefined)
      ?.replace(/[^\x00-\x7F]/g, '_')
      .replace(/[/\\?%*:|"<>\s]/g, '_')
      .replace(/_+/g, '_')
      ?? `${weekId}.bin`

    const fileBuffer = Buffer.from(fileData, 'base64')
    const { error: storageErr } = await supabase.storage
      .from('answer-sheets')
      .upload(safeName, fileBuffer, { contentType: mimeType, upsert: true })
    if (storageErr) {
      console.error('[parse-answers] storage upload 실패:', storageErr)
    } else {
      await supabase.from('week').update({ answer_sheet_path: safeName }).eq('id', weekId)
    }
  } catch (e) {
    console.error('[parse-answers] storage 저장 예외:', e)
  }

  const { data: existingQuestions } = await supabase
    .from('exam_question')
    .select('id, question_number, sub_label')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')

  const existingMap = new Map(
    (existingQuestions ?? []).map((question) => [`${question.question_number}|${question.sub_label ?? ''}`, question]),
  )
  const parsedKeys = new Set(parsedAnswers.map((answer) => `${answer.question_number}|${answer.sub_label ?? ''}`))

  type QuestionRow = {
    id: string
    question_number: number
    sub_label: string | null
    question_style: string
    correct_answer: number
    correct_answer_text: string | null
    grading_criteria: string | null
  }

  const questions: QuestionRow[] = []
  const VALID_STYLES = ['objective', 'subjective', 'ox', 'multi_select', 'find_error'] as const
  type QuestionStyle = typeof VALID_STYLES[number]

  const questionResults = await Promise.all(
    parsedAnswers.map(async (answer) => {
      const style: QuestionStyle = VALID_STYLES.includes(answer.question_style as QuestionStyle)
        ? answer.question_style as QuestionStyle
        : 'objective'
      const key = `${answer.question_number}|${answer.sub_label ?? ''}`
      const existing = existingMap.get(key)

      if (existing) {
        const { data, error } = await supabase
          .from('exam_question')
          .update({
            question_style: style,
            correct_answer: answer.correct_answer,
            correct_answer_text: answer.correct_answer_text,
            grading_criteria: answer.grading_criteria,
            explanation: answer.explanation ?? null,
            question_text: answer.question_text ?? null,
          })
          .eq('id', existing.id)
          .select('id, question_number, sub_label, question_style, correct_answer, correct_answer_text, grading_criteria')
          .single()
        if (error) console.error(`[parse-answers] UPDATE 실패 Q${answer.question_number}${answer.sub_label ?? ''}:`, error)
        return data
      }

      const { data, error } = await supabase
        .from('exam_question')
        .insert({
          week_id: weekId,
          exam_type: 'reading',
          question_number: answer.question_number,
          sub_label: answer.sub_label ?? null,
          question_style: style,
          correct_answer: answer.correct_answer,
          correct_answer_text: answer.correct_answer_text,
          grading_criteria: answer.grading_criteria,
          explanation: answer.explanation ?? null,
          question_text: answer.question_text ?? null,
        })
        .select('id, question_number, sub_label, question_style, correct_answer, correct_answer_text, grading_criteria')
        .single()
      if (error) console.error(`[parse-answers] INSERT 실패 Q${answer.question_number}${answer.sub_label ?? ''}:`, error)
      return data
    }),
  )
  questions.push(...questionResults.filter((item): item is QuestionRow => item !== null))

  const removedQuestions = (existingQuestions ?? []).filter(
    (question) => !parsedKeys.has(`${question.question_number}|${question.sub_label ?? ''}`),
  )
  if (removedQuestions.length > 0) {
    const removedIds = removedQuestions.map((question) => question.id)
    await supabase.from('student_answer').delete().in('exam_question_id', removedIds)
    await supabase.from('exam_question_tag').delete().in('exam_question_id', removedIds)
    await supabase.from('exam_question').delete().in('id', removedIds)
  }

  const tagInserts: { exam_question_id: string; concept_tag_id: string }[] = []
  for (const question of questions) {
    const parsed = parsedAnswers.find(
      (answer) => answer.question_number === question.question_number && (answer.sub_label ?? null) === question.sub_label,
    )
    const tagId = matchTagId(parsed?.question_type ?? null)
    if (tagId) tagInserts.push({ exam_question_id: question.id, concept_tag_id: tagId })
  }
  await supabase.from('exam_question_tag').delete().in('exam_question_id', questions.map((question) => question.id))
  if (tagInserts.length > 0) {
    await supabase.from('exam_question_tag').insert(tagInserts)
  }

  const { count: qCount } = await supabase
    .from('exam_question')
    .select('id', { count: 'exact', head: true })
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
  await supabase.from('week').update({ reading_total: qCount ?? parsedAnswers.length }).eq('id', weekId)

  const { data: weekScores } = await supabase
    .from('week_score')
    .select('id, student_id, student_answer(id, exam_question_id, student_answer, student_answer_text, is_correct)')
    .eq('week_id', weekId)

  if (!weekScores?.length) {
    return ok({ ok: true, questions_parsed: questions.length, students_regraded: 0, parse_mode_used: usedMode })
  }

  const studentIds = weekScores.map((score) => score.student_id)
  const { data: students } = await supabase
    .from('student')
    .select('id, name')
    .in('id', studentIds)
  const studentNameMap = new Map((students ?? []).map((student) => [student.id, student.name]))

  const questionByKey = new Map(questions.map((question) => [`${question.question_number}__${question.sub_label ?? ''}`, question]))
  const questionById = new Map(questions.map((question) => [question.id, question]))

  const subjectiveForGrading: SubjectiveStudentAnswer[] = []

  await Promise.all(
    weekScores.map(async (score) => {
      type AnswerRow = {
        id: string
        exam_question_id: string
        student_answer: number | null
        student_answer_text: string | null
        ox_selection: string | null
        is_correct: boolean
      }
      const answers: AnswerRow[] = (score.student_answer as unknown as AnswerRow[]) ?? []

      await Promise.all(
        answers.map(async (answer) => {
          const question = questionById.get(answer.exam_question_id)
          if (!question) return

          if (question.question_style === 'objective') {
            const isCorrect = answer.student_answer !== null && answer.student_answer === question.correct_answer
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
          } else if (question.question_style === 'ox' && answer.ox_selection) {
            const isCorrect = question.correct_answer_text
              ? gradeOX(question.correct_answer_text, answer.ox_selection, answer.student_answer_text ?? '')
              : false
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
          } else if (question.question_style === 'multi_select' && answer.student_answer_text?.trim()) {
            const isCorrect = question.correct_answer_text
              ? gradeMultiSelect(question.correct_answer_text, answer.student_answer_text)
              : false
            if (isCorrect !== answer.is_correct) {
              await supabase.from('student_answer').update({ is_correct: isCorrect }).eq('id', answer.id)
            }
          } else if (question.question_style === 'find_error' && answer.student_answer_text?.trim()) {
            await supabase.from('student_answer').update({
              is_correct: false,
              needs_review: true,
              ai_feedback: '채점 페이지에서 다시 검토해주세요.',
            }).eq('id', answer.id)
          } else if (question.question_style === 'subjective' && answer.student_answer_text?.trim()) {
            subjectiveForGrading.push({
              week_score_id: score.id,
              exam_question_id: answer.exam_question_id,
              question_number: question.question_number,
              sub_label: question.sub_label ?? null,
              student_name: studentNameMap.get(score.student_id) ?? score.student_id,
              student_answer_text: answer.student_answer_text.trim(),
            })
          }
        }),
      )
    }),
  )

  if (subjectiveForGrading.length > 0) {
    const uniqueKeys = [...new Set(subjectiveForGrading.map((answer) => `${answer.question_number}__${answer.sub_label ?? ''}`))]
    const subjectiveQuestions = uniqueKeys
      .map((key) => {
        const question = questionByKey.get(key)
        return question?.question_style === 'subjective' && question.correct_answer_text
          ? {
              question_number: question.question_number,
              sub_label: question.sub_label ?? null,
              correct_answer_text: question.correct_answer_text,
              grading_criteria: question.grading_criteria,
            }
          : null
      })
      .filter((question): question is NonNullable<typeof question> => question !== null)

    if (subjectiveQuestions.length > 0) {
      try {
        const gradingResults = await gradeSubjectiveAnswers(subjectiveQuestions, subjectiveForGrading)
        for (const result of gradingResults) {
          await supabase
            .from('student_answer')
            .update({ is_correct: result.is_correct, ai_feedback: result.ai_feedback })
            .eq('week_score_id', result.week_score_id)
            .eq('exam_question_id', result.exam_question_id)
        }
      } catch (e) {
        console.error('[parse-answers] 서술형 AI 채점 실패', e)
        await Promise.all(
          weekScores.map(async (score) => {
            const { data: answers } = await supabase
              .from('student_answer')
              .select('is_correct')
              .eq('week_score_id', score.id)
            const readingCorrect = answers && answers.length > 0
              ? answers.filter((answer) => answer.is_correct).length
              : null
            await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', score.id)
          }),
        )
        return ok({
          ok: true,
          questions_parsed: questions.length,
          students_regraded: weekScores.length,
          subjective_grading_failed: true,
          parse_mode_used: usedMode,
        })
      }
    }
  }

  await Promise.all(
    weekScores.map(async (score) => {
      const { data: answers } = await supabase
        .from('student_answer')
        .select('is_correct')
        .eq('week_score_id', score.id)
      const readingCorrect = answers && answers.length > 0
        ? answers.filter((answer) => answer.is_correct).length
        : null
      await supabase.from('week_score').update({ reading_correct: readingCorrect }).eq('id', score.id)
    }),
  )

    return ok({ ok: true, questions_parsed: questions.length, students_regraded: weekScores.length, parse_mode_used: usedMode })
  } catch (e) {
    console.error('[parse-answers] unhandled error:', e)
    const message = e instanceof Error ? e.message : '서버 처리 중 오류가 발생했습니다.'
    return err(message, 500)
  }
}
