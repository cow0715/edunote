import { getAuth, getTeacherId, assertWeekOwner, err, ok, SupabaseServerClient } from '@/lib/api'
import { gradeVocabItems } from '@/lib/anthropic'
import { gradeBlankAnswer, gradeChoiceAnswer } from '@/lib/vocab-blank-grading'
import { extractBlankAnswer, extractChoiceAnswerIndex, parseChoiceOptions } from '@/lib/vocab-example-blank'

import { gradePersistenceStatus, isGradeVersion, type GradeVersion } from '@/lib/atomic-grade'

const CODE_GRADED_SOURCES = ['example', 'example_choice']

export const maxDuration = 120

type AnswerOwnerRow = {
  id: string
  week_score_id: string
  week_score: { week_id: string } | { week_id: string }[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

async function getOwnedAnswerRows(supabase: SupabaseServerClient, authId: string, answerIds: string[]) {
  const teacherId = await getTeacherId(supabase, authId)
  if (!teacherId) return { error: err('강사 정보 없음', 404) }

  const { data, error } = await supabase
    .from('student_vocab_answer')
    .select('id, week_score_id, week_score(week_id)')
    .in('id', answerIds)

  if (error) return { error: err(error.message, 500) }
  const rows = (data ?? []) as unknown as AnswerOwnerRow[]
  if (rows.length !== answerIds.length) return { error: err('답안을 찾을 수 없습니다', 404) }

  const weekIds = [...new Set(rows.map((row) => one(row.week_score)?.week_id).filter((id): id is string => !!id))]
  if (weekIds.length === 0) return { error: err('답안 주차를 찾을 수 없습니다', 404) }
  for (const weekId of weekIds) {
    if (!await assertWeekOwner(supabase, weekId, teacherId)) return { error: err('접근 권한 없음', 403) }
  }

  return { rows }
}

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { id, student_answer, is_correct, teacher_locked, grade_version } = await request.json()
  if (!id || typeof is_correct !== 'boolean') return err('답안을 확인해주세요.')
  if (!isGradeVersion(grade_version) || !grade_version.score_id) return err('저장 버전을 확인해주세요.', 409)
  const owned = await getOwnedAnswerRows(supabase, user.id, [id])
  if ('error' in owned) return owned.error
  if (owned.rows[0]?.week_score_id !== grade_version.score_id) return err('학생 답안이 변경됐습니다.', 409)
  const weekId = one(owned.rows[0].week_score)?.week_id
  const { data: active, error: testError } = await supabase.from('vocab_test').select('id')
    .eq('week_id', weekId).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (testError) return err('시험지를 확인하지 못했습니다.', 503)
  const { data: versions, error } = await supabase.rpc('save_vocab_answer_edits', {
    p_score_id: grade_version.score_id, p_expected_revision: grade_version.revision,
    p_answers: [{ id, student_answer: student_answer ?? null, is_correct,
      ...(teacher_locked !== undefined ? { teacher_locked } : {}) }], p_regrade: false, p_expected_test_id: active?.id ?? null,
  })
  if (error) return err(error.message, gradePersistenceStatus(error.code))
  return ok({ ok: true, versions })
}

// 수정된 답안 재채점 — items: { id, number, english_word, student_answer }[]
export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { items, grade_version } = await request.json() as {
    weekScoreId: string
    grade_version: GradeVersion
    items: { id: string; number: number; english_word: string; student_answer: string | null }[]
  }
  if (!items?.length) return err('items 필요')
  if (new Set(items.map((item) => item.number)).size !== items.length) return err('문항이 중복됐습니다.', 422)
  if (!isGradeVersion(grade_version) || !grade_version.score_id) return err('저장 버전을 확인해주세요.', 409)
  const owned = await getOwnedAnswerRows(supabase, user.id, items.map((i) => i.id))
  if ('error' in owned) return owned.error

  if (owned.rows.some((row) => row.week_score_id !== grade_version.score_id)) return err('학생 답안을 확인해주세요.', 409)
  const weekId = one(owned.rows[0].week_score)?.week_id
  const { data: currentTest, error: currentTestError } = await supabase.from('vocab_test').select('id')
    .eq('week_id', weekId).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (currentTestError) return err('시험지를 확인하지 못했습니다.', 503)
  // correct_answer 조회 (student_vocab_answer → vocab_word)
  // 예문빈칸(test_source='example')은 정답이 문장 속 영어 표면형이라 활성 시험지의 prompt_text 로 역산한다.
  const { data: answerDetails, error: detailsError } = await supabase
    .from('student_vocab_answer')
    .select('id, test_source, test_number, vocab_word_id, vocab_word(correct_answer, english_word, example_sentence), vocab_word_variant(meaning)')
    .in('id', items.map((i) => i.id))

  if (detailsError || !answerDetails || answerDetails.length !== items.length) return err('답안을 확인하지 못했습니다.', 503)
  const detailRows = (answerDetails ?? []) as unknown as Array<{
    id: string
    test_source: string | null
    test_number: number | null
    vocab_word_id: string
    vocab_word: { correct_answer: string | null; english_word: string; example_sentence: string | null } | null
    vocab_word_variant: { meaning: string | null } | null
  }>

  const blankRows = detailRows.filter((a) => CODE_GRADED_SOURCES.includes(a.test_source ?? ''))
  const blankPromptByWordId = new Map<string, string | null>()
  if (blankRows.length && currentTest?.id) {
    const { data: testItems, error: itemsError } = await supabase.from('vocab_test_item')
      .select('vocab_word_id, prompt_text').eq('vocab_test_id', currentTest.id)
      .in('prompt_source', CODE_GRADED_SOURCES).in('vocab_word_id', blankRows.map((a) => a.vocab_word_id))
    if (itemsError) return err('시험 문항을 확인하지 못했습니다.', 503)
    for (const ti of testItems ?? []) blankPromptByWordId.set(ti.vocab_word_id, ti.prompt_text)
  }

  const correctAnswerById = new Map(
    detailRows.map((a) => {
      if (a.test_source === 'example') {
        const answer = extractBlankAnswer(a.vocab_word?.example_sentence, blankPromptByWordId.get(a.vocab_word_id))
          ?? a.vocab_word?.english_word
          ?? null
        return [a.id, answer] as const
      }
      if (a.test_source === 'example_choice') {
        const promptText = blankPromptByWordId.get(a.vocab_word_id)
        const index = extractChoiceAnswerIndex(a.vocab_word?.example_sentence, promptText)
        const options = parseChoiceOptions(promptText)
        const answer = (index !== null && options ? options[index] : null) ?? a.vocab_word?.english_word ?? null
        return [a.id, answer] as const
      }
      return [a.id, a.vocab_word_variant?.meaning ?? a.vocab_word?.correct_answer ?? null] as const
    })
  )
  const blankIds = new Set(blankRows.map((a) => a.id))
  const choiceIds = new Set(blankRows.filter((a) => a.test_source === 'example_choice').map((a) => a.id))

  const itemsWithAnswer = items.map((i) => ({
    ...i,
    correct_answer: correctAnswerById.get(i.id) ?? null,
  }))

  const { data: promptRow, error: promptError } = await supabase.from('prompts').select('content').eq('key', 'vocab_grading_rules').maybeSingle()
  if (promptError) return err('채점 기준을 확인하지 못했습니다.', 503)
  const customRules = promptRow?.content ?? undefined

  // 예문빈칸은 코드 비교, 나머지는 LLM 뜻 채점
  const blankItems = itemsWithAnswer.filter((i) => blankIds.has(i.id))
  const meaningItems = itemsWithAnswer.filter((i) => !blankIds.has(i.id))
  const graded = [
    ...(meaningItems.length > 0 ? await gradeVocabItems(meaningItems, customRules) : []),
    ...blankItems.map((i) => ({
      number: i.number,
      english_word: i.english_word,
      student_answer: i.student_answer,
      is_correct: choiceIds.has(i.id)
        ? gradeChoiceAnswer(i.student_answer, i.correct_answer)
        : gradeBlankAnswer(i.student_answer, i.correct_answer),
    })),
  ]

  if (graded.length !== items.length || new Set(graded.map((g) => g.number)).size !== items.length ||
    graded.some((g) => !items.some((item) => item.number === g.number))) return err('일부 채점 결과를 확인하지 못했습니다.', 503)
  const { data: versions, error: saveError } = await supabase.rpc('save_vocab_answer_edits', {
    p_score_id: grade_version.score_id, p_expected_revision: grade_version.revision, p_regrade: true,
    p_expected_test_id: currentTest?.id ?? null,
    p_answers: graded.map((g) => ({ id: items.find((item) => item.number === g.number)!.id,
      student_answer: g.student_answer ?? null, is_correct: g.is_correct })),
  })
  if (saveError) return err(saveError.message, gradePersistenceStatus(saveError.code))
  return ok({ ok: true, versions, results: graded })
}
