import { sql } from 'drizzle-orm'
import { requireGradeToken, saveGradePlan, activeVocabTotals } from '@/lib/services/grade-save'
import { updateRows, type Statement } from '@/lib/db/statements'
import { saveErrorResponse, SaveError } from '@/lib/db/errors'
import { getAuth, getTeacherId, assertWeekOwner, err, ok, SupabaseServerClient } from '@/lib/api'
import { gradeVocabItems } from '@/lib/anthropic'
import { gradeBlankAnswer, gradeChoiceAnswer } from '@/lib/vocab-blank-grading'
import { extractBlankAnswer, extractChoiceAnswerIndex, parseChoiceOptions } from '@/lib/vocab-example-blank'

const CODE_GRADED_SOURCES = ['example', 'example_choice']

export const maxDuration = 120

type AnswerOwnerRow = {
  id: string
  week_score_id: string
  week_score: { week_id: string; student_id: string } | { week_id: string; student_id: string }[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

async function getOwnedAnswerRows(supabase: SupabaseServerClient, authId: string, answerIds: string[]) {
  const teacherId = await getTeacherId(supabase, authId)
  if (!teacherId) return { error: err('강사 정보 없음', 404) }

  const { data, error } = await supabase
    .from('student_vocab_answer')
    .select('id, week_score_id, week_score(week_id,student_id)')
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
  try { return await handlePATCH(request) } catch (error) { return saveErrorResponse(error) }
}
async function handlePATCH(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { id, week_score_id, student_answer, is_correct, teacher_locked, grade_version } = await request.json()
  if (!id) return err('id 필요')
  const owned = await getOwnedAnswerRows(supabase, user.id, [id])
  if ('error' in owned) return owned.error
  const actualWeekScoreId = owned.rows[0]?.week_score_id

  const weekId = one(owned.rows[0].week_score)?.week_id
  if (!weekId || !actualWeekScoreId) throw new SaveError('답안 주차를 찾을 수 없습니다.',404)
  if (week_score_id && week_score_id !== actualWeekScoreId) throw new SaveError('성적과 답안이 일치하지 않습니다.',403)
  const version = requireGradeToken(grade_version)
  const statements: Statement[] = [updateRows('student_vocab_answer', {
    student_answer:student_answer??null,is_correct,...(teacher_locked!==undefined?{teacher_locked}:{}),
  },sql`id=${id}::uuid and week_score_id=${actualWeekScoreId}::uuid`,true),...activeVocabTotals([actualWeekScoreId])]
  const saved = await saveGradePlan(user.id,weekId,version,statements,[one(owned.rows[0].week_score)!.student_id])

  return ok(saved)
}

// 수정된 답안 재채점 — items: { id, number, english_word, student_answer }[]
export async function POST(request: Request) {
  try { return await handlePOST(request) } catch (error) { return saveErrorResponse(error) }
}
async function handlePOST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { weekScoreId, items, grade_version } = await request.json() as {
    grade_version: unknown
    weekScoreId: string
    items: { id: string; number: number; english_word: string; student_answer: string | null }[]
  }
  if (!items?.length) return err('items 필요')
  const owned = await getOwnedAnswerRows(supabase, user.id, items.map((i) => i.id))
  if ('error' in owned) return owned.error
  const actualWeekScoreId = owned.rows[0]?.week_score_id

  if (!actualWeekScoreId || owned.rows.some(row=>row.week_score_id!==actualWeekScoreId)) throw new SaveError('한 학생의 답안만 요청해주세요.')
  if (weekScoreId && weekScoreId!==actualWeekScoreId) throw new SaveError('성적과 답안이 일치하지 않습니다.',403)
  const weekId=one(owned.rows[0].week_score)?.week_id
  if (!weekId) throw new SaveError('답안 주차를 찾을 수 없습니다.',404)
  const version=requireGradeToken(grade_version)
  // correct_answer 조회 (student_vocab_answer → vocab_word)
  // 예문빈칸(test_source='example')은 정답이 문장 속 영어 표면형이라 활성 시험지의 prompt_text 로 역산한다.
  const { data: answerDetails, error: detailError } = await supabase
    .from('student_vocab_answer')
    .select('id, teacher_locked, test_source, test_number, vocab_word_id, vocab_word(correct_answer, english_word, example_sentence), vocab_word_variant(meaning)')
    .in('id', items.map((i) => i.id))

  if (detailError) throw new SaveError('답안 조회 실패',503)
  const detailRows = (answerDetails ?? []) as unknown as Array<{
    id: string
    teacher_locked: boolean
    test_source: string | null
    test_number: number | null
    vocab_word_id: string
    vocab_word: { correct_answer: string | null; english_word: string; example_sentence: string | null } | null
    vocab_word_variant: { meaning: string | null } | null
  }>

  if (detailRows.length !== items.length || new Set(items.map(i=>i.id)).size !== items.length || detailRows.some(a=>a.teacher_locked)) throw new SaveError('확정됐거나 누락/중복된 답안입니다. 새로고침해주세요.',409)
  if (new Set(items.map(i=>i.number)).size!==items.length) throw new SaveError('문항 번호가 중복됐습니다.',422)
  const blankRows = detailRows.filter((a) => CODE_GRADED_SOURCES.includes(a.test_source ?? ''))
  const blankPromptByWordId = new Map<string, string | null>()
  if (blankRows.length > 0 && (actualWeekScoreId || weekScoreId)) {
    const { data: scoreRow, error: scoreError } = await supabase
      .from('week_score')
      .select('week_id')
      .eq('id', actualWeekScoreId ?? weekScoreId)
      .maybeSingle()
    if (scoreError || !scoreRow) throw new SaveError('점수 조회 실패',503)
    if (scoreRow?.week_id) {
      const { data: activeTest, error: testError } = await supabase
        .from('vocab_test')
        .select('id')
        .eq('week_id', scoreRow.week_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (testError) throw new SaveError('시험지 조회 실패',503)
      if (activeTest) {
        const { data: testItems, error: itemsError } = await supabase
          .from('vocab_test_item')
          .select('vocab_word_id, prompt_text')
          .eq('vocab_test_id', activeTest.id)
          .in('prompt_source', CODE_GRADED_SOURCES)
          .in('vocab_word_id', blankRows.map((a) => a.vocab_word_id))
        if (itemsError) throw new SaveError('시험 문항 조회 실패',503)
        for (const ti of testItems ?? []) blankPromptByWordId.set(ti.vocab_word_id, ti.prompt_text)
      }
    }
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
  if (promptError) throw new SaveError('채점 규칙 조회 실패',503)
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

  const statements: Statement[] = []
  if (graded.length!==items.length || graded.some(g=>!g || !Number.isSafeInteger(g.number) || g.number<1 || typeof g.is_correct!=='boolean' || (g.student_answer!=null && typeof g.student_answer!=='string')) || new Set(graded.map(g=>g.number)).size!==items.length) throw new SaveError('일부 채점 결과가 잘못됐거나 누락/중복됐습니다.',422)
  for (const g of graded) {
    const orig = items.find(item=>item.number===g.number)
    if (!orig) throw new SaveError('채점 응답이 요청 문항과 일치하지 않습니다.',422)
    statements.push(updateRows('student_vocab_answer',{student_answer:g.student_answer??null,is_correct:g.is_correct,teacher_locked:false},
      sql`id=${orig.id}::uuid and week_score_id=${actualWeekScoreId}::uuid`,true))
  }
  statements.push(...activeVocabTotals([actualWeekScoreId]))
  const saved = await saveGradePlan(user.id,weekId,version,statements,[one(owned.rows[0].week_score)!.student_id])

  return ok({ ...saved, results: graded })
}
