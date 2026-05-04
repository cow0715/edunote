import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { gradeVocabItems } from '@/lib/anthropic'

export const maxDuration = 60

type VocabWordInput = {
  number: number
  passage_label?: string | null
  english_word: string
  part_of_speech?: string | null
  correct_answer: string | null
  synonyms?: string[] | null
  antonyms?: string[] | null
  derivatives?: string | null
  source_row_index?: number | null
}

type OldWordRow = {
  id: string
  number: number
  english_word: string
  example_sentence: string | null
  example_translation: string | null
  example_source: string | null
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const { data, error } = await supabase
    .from('vocab_word')
    .select('number, passage_label, english_word, part_of_speech, correct_answer, synonyms, antonyms, derivatives, source_row_index, example_sentence, example_translation, example_source')
    .eq('week_id', weekId)
    .order('number')

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const { words, sourceType, sourceFileName } = await request.json() as {
    words?: VocabWordInput[]
    sourceType?: 'xlsx' | 'legacy_ai'
    sourceFileName?: string | null
  }
  if (!words?.length) return err('단어 없음')

  // ── 1. 기존 vocab_word ID 조회 ────────────────────────────────────────
  const { data: oldWords } = await supabase
    .from('vocab_word')
    .select('id, number, english_word, example_sentence, example_translation, example_source')
    .eq('week_id', weekId)

  const oldRows = (oldWords ?? []) as OldWordRow[]

  const oldWordIds = oldRows.map((w) => w.id)

  // ── 2. 학생 답안 백업 (기존 단어가 있을 때만) ──────────────────────────
  type AnswerBackup = {
    week_score_id: string
    number: number
    english_word: string
    student_answer: string | null
    is_correct: boolean
    teacher_locked: boolean
    retake_answer: string | null
    retake_is_correct: boolean | null
  }
  let backup: AnswerBackup[] = []

  if (oldWordIds.length > 0) {
    const { data: answerRows } = await supabase
      .from('student_vocab_answer')
      .select('week_score_id, vocab_word_id, student_answer, is_correct, teacher_locked, retake_answer, retake_is_correct')
      .in('vocab_word_id', oldWordIds)

    if (answerRows && answerRows.length > 0) {
      const oldWordMap = new Map(oldRows.map((w) => [w.id, w]))
      backup = answerRows
        .map((a) => {
          const word = oldWordMap.get(a.vocab_word_id)
          if (!word) return null
          return {
            week_score_id: a.week_score_id,
            number: word.number,
            english_word: word.english_word,
            student_answer: a.student_answer,
            is_correct: a.is_correct,
            teacher_locked: a.teacher_locked ?? false,
            retake_answer: a.retake_answer ?? null,
            retake_is_correct: a.retake_is_correct ?? null,
          }
        })
        .filter((x): x is AnswerBackup => x !== null)
    }
  }

  // ── 3. 기존 vocab_word 전체 삭제 (cascade → student_vocab_answer 삭제) ──
  if (oldWordIds.length > 0) {
    await supabase.from('vocab_word').delete().eq('week_id', weekId)
  }

  // ── 4. 새 vocab_word insert ───────────────────────────────────────────
  const shouldPreserveExistingExamples = !sourceType
  const oldWordByStableKey = new Map(oldRows.map((w) => [`${w.number}::${w.english_word.trim().toLowerCase()}`, w]))

  const { data: insertedWords, error: insertError } = await supabase
    .from('vocab_word')
    .insert(
      words.map((w) => {
        const oldWord = oldWordByStableKey.get(`${w.number}::${w.english_word.trim().toLowerCase()}`)
        return {
          week_id: weekId,
          number: w.number,
          passage_label: w.passage_label ?? null,
          english_word: w.english_word,
          part_of_speech: w.part_of_speech ?? null,
          correct_answer: w.correct_answer ?? null,
          synonyms: w.synonyms ?? [],
          antonyms: w.antonyms ?? [],
          derivatives: w.derivatives ?? null,
          source_row_index: w.source_row_index ?? null,
          example_sentence: shouldPreserveExistingExamples ? oldWord?.example_sentence ?? null : null,
          example_translation: shouldPreserveExistingExamples ? oldWord?.example_translation ?? null : null,
          example_source: shouldPreserveExistingExamples ? oldWord?.example_source ?? null : null,
        }
      })
    )
    .select('id, number, english_word, correct_answer, synonyms')

  if (insertError) {
    console.error('[vocab-words] insert 실패', insertError)
    return err(insertError.message, 500)
  }

  const newWords = (insertedWords ?? []) as {
    id: string
    number: number
    english_word: string
    correct_answer: string | null
    synonyms: string[] | null
  }[]

  // ── 5. 백업된 답안 재채점 후 재삽입 ──────────────────────────────────
  const { data: promptRow } = await supabase.from('prompts').select('content').eq('key', 'vocab_grading_rules').maybeSingle()
  const customRules = promptRow?.content ?? undefined

  if (backup.length > 0 && newWords) {
    const newWordByNumber = new Map(newWords.map((w) => [w.number, w]))

    // week_score_id 기준으로 그룹핑
    const byScore = new Map<string, AnswerBackup[]>()
    for (const a of backup) {
      if (!byScore.has(a.week_score_id)) byScore.set(a.week_score_id, [])
      byScore.get(a.week_score_id)!.push(a)
    }

    for (const [weekScoreId, answers] of byScore) {
      // teacher_locked 답안은 AI 채점 없이 기존 is_correct 유지
      const unlocked = answers.filter((a) => !a.teacher_locked)

      // unlocked 답안만 AI 재채점
      const itemsToGrade = unlocked
        .map((a) => {
          const newWord = newWordByNumber.get(a.number)
          if (!newWord) return null
          return {
            number: a.number,
            english_word: newWord.english_word,
            student_answer: a.student_answer,
            correct_answer: newWord.correct_answer ?? null,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)

      let regradedMap = new Map<number, boolean>()
      if (itemsToGrade.length > 0) {
        try {
          const regraded = await gradeVocabItems(itemsToGrade, customRules)
          regradedMap = new Map(regraded.map((r) => [r.number, r.is_correct]))
        } catch (e) {
          console.error('[vocab-words] 재채점 실패', e)
          // 재채점 실패 시 기존 is_correct 유지
          for (const a of unlocked) regradedMap.set(a.number, a.is_correct)
        }
      }

      // student_vocab_answer 재삽입
      const toInsert = answers
        .map((a) => {
          const newWord = newWordByNumber.get(a.number)
          if (!newWord) return null // 새 파일에 없는 번호는 버림
          const isCorrect = a.teacher_locked
            ? a.is_correct
            : (regradedMap.get(a.number) ?? a.is_correct)
          return {
            week_score_id: weekScoreId,
            vocab_word_id: newWord.id,
            student_answer: a.student_answer,
            is_correct: isCorrect,
            teacher_locked: a.teacher_locked,
            retake_answer: a.retake_answer,
            retake_is_correct: a.retake_is_correct,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)

      if (toInsert.length > 0) {
        await supabase.from('student_vocab_answer').insert(toInsert)
      }

      // week_score 재집계 (vocab_correct + vocab_retake_correct)
      const vocabCorrect = toInsert.filter((a) => a.is_correct).length
      const vocabRetakeCorrect = toInsert.filter((a) => !a.is_correct && a.retake_is_correct === true).length
      await supabase.from('week_score')
        .update({ vocab_correct: vocabCorrect, vocab_retake_correct: vocabRetakeCorrect })
        .eq('id', weekScoreId)
    }
  }

  // ── 6. vocab_total 및 원본 메타데이터 업데이트 ───────────────────────
  const weekUpdate: Record<string, unknown> = { vocab_total: words.length }
  if (sourceType) {
    weekUpdate.vocab_source_type = sourceType
    weekUpdate.vocab_source_file_name = sourceFileName ?? null
    weekUpdate.vocab_source_uploaded_at = new Date().toISOString()
    weekUpdate.vocab_examples_generated_at = null
  }

  await supabase.from('week').update(weekUpdate).eq('id', weekId)

  return ok({ ok: true, saved: words.length, regraded: backup.length > 0 })
}
