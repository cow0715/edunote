import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { gradeVocabPhoto } from '@/lib/anthropic'

export const maxDuration = 60

type VocabWordForGrading = {
  id: string
  number: number
  english_word: string
  correct_answer: string | null
  test_word?: string | null
  test_source?: string | null
}

type VocabTestItemForGrading = {
  test_number: number
  sort_order: number
  prompt_source: string | null
  prompt_text: string | null
  vocab_word: VocabWordForGrading | VocabWordForGrading[] | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  const { studentId, fileData, mimeType } = await request.json()
  if (!fileData || !mimeType || !studentId) {
    return err('필수 파라미터 없음')
  }
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  const { data: weekRow } = await supabase
    .from('week')
    .select('class_id, vocab_source_type')
    .eq('id', weekId)
    .single()
  if (!weekRow) return err('주차 없음', 404)
  const { data: classStudent } = await supabase
    .from('class_student')
    .select('student_id')
    .eq('class_id', weekRow.class_id)
    .eq('student_id', studentId)
    .maybeSingle()
  if (!classStudent) return err('해당 수업 학생이 아닙니다', 403)

  // ── 1. 활성 시험지가 있으면 시험지 문항 기준, 없으면 기존 vocab_word 기준 ──
  const { data: activeTest } = await supabase
    .from('vocab_test')
    .select('id, item_count')
    .eq('week_id', weekId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let testItems: VocabTestItemForGrading[] = []
  if (activeTest) {
    const { data } = await supabase
      .from('vocab_test_item')
      .select('test_number, sort_order, prompt_source, prompt_text, vocab_word(id, number, english_word, correct_answer)')
      .eq('vocab_test_id', activeTest.id)
      .order('sort_order')
    testItems = (data ?? []) as unknown as VocabTestItemForGrading[]
  }

  const { data: existingVocabWords } = await supabase
    .from('vocab_word')
    .select('id, number, english_word, correct_answer')
    .eq('week_id', weekId)

  if (!activeTest && weekRow.vocab_source_type && weekRow.vocab_source_type !== 'legacy' && (existingVocabWords?.length ?? 0) > 0) {
    return err('시험용 단어를 먼저 선택해주세요', 422)
  }

  const gradingWords: VocabWordForGrading[] = testItems.length > 0
    ? testItems
        .flatMap((item) => {
          const word = one(item.vocab_word)
          if (!word) return []
          return [{
            ...word,
            number: item.test_number,
            test_word: item.prompt_text || word.english_word,
            test_source: item.prompt_source ?? 'word',
          }]
        })
    : (existingVocabWords ?? []) as VocabWordForGrading[]

  const correctAnswerMap = new Map<number, string | null>(
    gradingWords.map((w) => [w.number, w.correct_answer ?? null])
  )

  // ── 2. AI 채점 (correct_answer를 채점 기준으로 전달) ────────────────────
  const { data: promptRow } = await supabase.from('prompts').select('content').eq('key', 'vocab_grading_rules').maybeSingle()
  const customRules = promptRow?.content ?? undefined

  let results
  try {
    results = await gradeVocabPhoto(fileData, mimeType, correctAnswerMap.size > 0 ? correctAnswerMap : undefined, customRules)
  } catch (e) {
    console.error('[grade-vocab-photo] AI 채점 실패', e)
    return err('단어 채점 실패. 사진을 확인해주세요.', 422)
  }

  if (!results.length) {
    return err('단어를 찾을 수 없습니다', 422)
  }

  // ── 3. vocab_word 매핑 ──────────────────────────────────────────────────
  // 기존 단어가 있으면 OCR로 덮어쓰지 않고 그대로 사용 (OCR 오류로 인한 단어 오염 방지)
  // 기존 단어가 없으면 OCR 결과로 생성
  let vocabWordMap: Map<number, string>

  if (gradingWords.length > 0) {
    vocabWordMap = new Map(gradingWords.map((w) => [w.number, w.id]))

    // 활성 시험지가 없을 때만 OCR에서 기존에 없는 번호를 새 단어로 보강
    const existingNumbers = new Set(gradingWords.map((w) => w.number))
    const newWordRows = results.filter((r) => !existingNumbers.has(r.number))
    if (!activeTest && newWordRows.length > 0) {
      const { data: inserted } = await supabase
        .from('vocab_word')
        .insert(newWordRows.map((r) => ({ week_id: weekId, number: r.number, english_word: r.english_word })))
        .select('id, number')
      for (const w of inserted ?? []) vocabWordMap.set(w.number, w.id)
    }
  } else {
    const { data: vocabWords, error: vocabWordError } = await supabase
      .from('vocab_word')
      .upsert(
        results.map((r) => ({ week_id: weekId, number: r.number, english_word: r.english_word })),
        { onConflict: 'week_id,number' }
      )
      .select('id, number')

    if (vocabWordError) {
      console.error('[grade-vocab-photo] vocab_word upsert 실패', vocabWordError)
      return err(vocabWordError.message, 500)
    }
    vocabWordMap = new Map((vocabWords ?? []).map((w) => [w.number, w.id]))
  }

  // ── 4. week_score 확보 (기존 row id 필요) ────────────────────────────────
  // 먼저 기존 row 조회, 없으면 생성
  let score: { id: string }
  {
    const { data: existing } = await supabase
      .from('week_score')
      .select('id')
      .eq('week_id', weekId)
      .eq('student_id', studentId)
      .maybeSingle()

    if (existing) {
      score = existing
    } else {
      const { data: created, error: createError } = await supabase
        .from('week_score')
        .insert({ week_id: weekId, student_id: studentId })
        .select('id')
        .single()
      if (createError || !created) {
        console.error('[grade-vocab-photo] week_score 생성 실패', createError)
        return err('week_score 생성 실패', 500)
      }
      score = created
    }
  }

  // ── 5. student_vocab_answer upsert ─────────────────────────────────────
  // teacher_locked=true 항목은 AI 결과로 덮어쓰지 않음 (is_correct + student_answer 모두 보존)
  const { data: lockedAnswers } = await supabase
    .from('student_vocab_answer')
    .select('vocab_word_id, is_correct, student_answer, test_number')
    .eq('week_score_id', score.id)
    .eq('teacher_locked', true)
  const lockedMap = new Map(
    (lockedAnswers ?? []).map((a) => [a.vocab_word_id, { is_correct: a.is_correct, student_answer: a.student_answer, test_number: a.test_number as number | null }])
  )

  // OCR 번호 이탈 대비: 번호 매칭 실패 시 english_word로 fallback 매칭
  const vocabWordByEnglish = new Map(
    gradingWords.flatMap((w) => [
      [w.english_word.toLowerCase(), w.id] as const,
      ...(w.test_word ? [[w.test_word.toLowerCase(), w.id] as const] : []),
    ])
  )
  const gradingWordById = new Map(gradingWords.map((w) => [w.id, w]))
  const answerInserts = results
    .map((r) => {
      let vocabWordId = vocabWordMap.get(r.number)
      if (!vocabWordId && r.english_word) {
        // 번호가 틀렸어도 단어명이 정확하면 올바른 vocab_word에 연결
        vocabWordId = vocabWordByEnglish.get(r.english_word.toLowerCase())
        if (vocabWordId) {
          console.warn(`[grade-vocab-photo] 번호 불일치 fallback: OCR number=${r.number} word="${r.english_word}" → english_word 매칭으로 연결`)
        }
      }
      if (!vocabWordId) return null
      // teacher_locked 항목은 기존 is_correct + student_answer 모두 보존
      const locked = lockedMap.get(vocabWordId)
      const gradingWord = gradingWordById.get(vocabWordId)
      return {
        week_score_id: score.id,
        vocab_word_id: vocabWordId,
        test_number: r.number,
        test_word: gradingWord?.test_word ?? r.english_word,
        test_source: gradingWord?.test_source ?? (activeTest ? 'word' : null),
        student_answer: locked ? locked.student_answer : (r.student_answer || null),
        is_correct: locked ? locked.is_correct : r.is_correct,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (answerInserts.length > 0) {
    const { error: answerError } = await supabase
      .from('student_vocab_answer')
      .upsert(answerInserts, { onConflict: 'week_score_id,vocab_word_id' })
    if (answerError) console.error('[grade-vocab-photo] student_vocab_answer upsert 실패', answerError)
  }

  // ── 4-b. vocab_correct 계산 후 업데이트 (매핑 성공 항목만, teacher_locked 반영) ──
  const vocabCorrect = answerInserts.filter((a) => a.is_correct).length
  await supabase.from('week_score').update({ vocab_correct: vocabCorrect }).eq('id', score.id)

  // ── 6. week.vocab_total 자동 업데이트 ────────────────────────────────
  // 기존 단어가 있으면 그 수를 기준으로, 없으면 OCR 결과 수 사용
  const vocabTotal = gradingWords.length > 0 ? gradingWords.length : results.length
  await supabase.from('week').update({ vocab_total: vocabTotal }).eq('id', weekId)

  // ── 7. 사진 Storage 업로드 (채점과 독립적으로 처리) ───────────────────
  try {
    const ext = mimeType.includes('png') ? 'png' : 'jpg'
    const storagePath = `${weekId}/${studentId}.${ext}`
    const buffer = Buffer.from(fileData, 'base64')
    const { error: uploadError } = await supabase.storage
      .from('vocab-photos')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true })
    if (!uploadError) {
      await supabase.from('week_score').update({ vocab_photo_path: storagePath }).eq('id', score.id)
    } else {
      console.error('[grade-vocab-photo] 사진 업로드 실패', uploadError)
    }
  } catch (e) {
    console.error('[grade-vocab-photo] 사진 업로드 예외', e)
  }

  return ok({ ok: true, vocab_correct: vocabCorrect, vocab_total: answerInserts.length, results })
}
