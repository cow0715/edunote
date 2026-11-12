import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { gradePersistenceStatus } from '@/lib/atomic-grade'
import { gradeVocabPhoto } from '@/lib/anthropic'
import type { VocabOcrExampleItem, VocabOcrExpectedItem } from '@/lib/prompts'
import { extractBlankAnswer, extractChoiceAnswerIndex, parseChoiceOptions } from '@/lib/vocab-example-blank'

// 한 학생 15~20초. 일괄 채점(15명 안쪽)을 한 요청에서 병렬로 돌릴 수 있게 Pro 상한까지.
export const maxDuration = 300

type VocabWordForGrading = {
  id: string
  number: number
  english_word: string
  correct_answer: string | null
  example_sentence?: string | null
  test_word?: string | null
  test_source?: string | null
  vocab_word_variant_id?: string | null
}

type VocabTestItemForGrading = {
  test_number: number
  sort_order: number
  prompt_source: string | null
  prompt_text: string | null
  vocab_word: VocabWordForGrading | VocabWordForGrading[] | null
  vocab_word_variant: {
    id: string
    word: string
    meaning: string | null
    relation_type: string
  } | { id: string; word: string; meaning: string | null; relation_type: string }[] | null
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

  const { data: weekRow, error: weekError } = await supabase
    .from('week')
    .select('class_id, vocab_source_type')
    .eq('id', weekId)
    .single()
  if (weekError) return err('주차 정보를 불러오지 못했습니다.', 503)
  if (!weekRow) return err('주차 없음', 404)
  const { data: classStudent, error: studentError } = await supabase
    .from('class_student')
    .select('student_id')
    .eq('class_id', weekRow.class_id)
    .eq('student_id', studentId)
    .maybeSingle()
  if (studentError) return err('학생 정보를 불러오지 못했습니다.', 503)
  if (!classStudent) return err('해당 수업 학생이 아닙니다', 403)

  // ── 1. 활성 시험지가 있으면 시험지 문항 기준, 없으면 기존 vocab_word 기준 ──
  const { data: activeTest, error: testError } = await supabase
    .from('vocab_test')
    .select('id, item_count')
    .eq('week_id', weekId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (testError) return err('시험지를 불러오지 못했습니다.', 503)

  let testItems: VocabTestItemForGrading[] = []
  if (activeTest) {
    const { data, error: itemError } = await supabase
      .from('vocab_test_item')
      .select('test_number, sort_order, prompt_source, prompt_text, vocab_word(id, number, english_word, correct_answer, example_sentence), vocab_word_variant(id, word, meaning, relation_type)')
      .eq('vocab_test_id', activeTest.id)
      .order('sort_order')
    if (itemError) return err('시험 문항을 불러오지 못했습니다.', 503)
    testItems = (data ?? []) as unknown as VocabTestItemForGrading[]
    if (!testItems.length) return err('시험지에 채점할 문항이 없습니다. 시험지를 확인해주세요.', 422)
  }

  const { data: existingVocabWords, error: wordsError } = await supabase
    .from('vocab_word')
    .select('id, number, english_word, correct_answer')
    .eq('week_id', weekId)

  if (wordsError || !existingVocabWords) return err('단어 목록을 불러오지 못했습니다.', 503)

  if (!activeTest && weekRow.vocab_source_type && weekRow.vocab_source_type !== 'legacy' && (existingVocabWords?.length ?? 0) > 0) {
    return err('시험용 단어를 먼저 선택해주세요', 422)
  }

  // 예문 파트 문항: OCR 파서에 인쇄 원문을 알려주기 위해 따로 모은다 (정답은 넣지 않음)
  const exampleItems: VocabOcrExampleItem[] = []

  const gradingWords: VocabWordForGrading[] = testItems.length > 0
    ? testItems
        .flatMap((item) => {
          const word = one(item.vocab_word)
          if (!word) return []
          const variant = one(item.vocab_word_variant)
          const source = item.prompt_source ?? 'word'

          if (source === 'example_meaning' || source === 'example' || source === 'example_choice') {
            const kind = source === 'example' ? 'blank' : source === 'example_choice' ? 'choice' : 'meaning'
            exampleItems.push({
              number: item.test_number,
              printed_sentence: item.prompt_text ?? word.example_sentence ?? '',
              kind,
            })
            // 예문뜻: 정답은 단어의 한글 뜻 / 예문빈칸: 문장 속 영어 표면형 / 예문선택: 정답 후보 단어
            let correctAnswer: string | null = word.correct_answer
            if (kind === 'blank') {
              correctAnswer = extractBlankAnswer(word.example_sentence, item.prompt_text) ?? word.english_word
            } else if (kind === 'choice') {
              const index = extractChoiceAnswerIndex(word.example_sentence, item.prompt_text)
              const options = parseChoiceOptions(item.prompt_text)
              correctAnswer = (index !== null && options ? options[index] : null) ?? word.english_word
            }
            return [{
              ...word,
              number: item.test_number,
              english_word: word.english_word,
              correct_answer: correctAnswer,
              test_word: word.english_word,
              test_source: source,
              vocab_word_variant_id: null,
            }]
          }

          return [{
            ...word,
            number: item.test_number,
            english_word: variant?.word ?? item.prompt_text ?? word.english_word,
            correct_answer: variant?.meaning ?? word.correct_answer,
            test_word: variant?.word ?? item.prompt_text ?? word.english_word,
            test_source: variant?.relation_type ?? source,
            vocab_word_variant_id: variant?.id ?? null,
          }]
        })
    : (existingVocabWords ?? []) as VocabWordForGrading[]

  const correctAnswerMap = new Map<number, string | null>(
    gradingWords.map((w) => [w.number, w.correct_answer ?? null])
  )

  // ── 2. AI 채점 (correct_answer를 채점 기준으로 전달) ────────────────────
  const { data: promptRow, error: promptError } = await supabase.from('prompts').select('content').eq('key', 'vocab_grading_rules').maybeSingle()
  if (promptError) return err('채점 기준을 불러오지 못했습니다.', 503)
  const { data: existingScore, error: scoreError } = await supabase.from('week_score')
    .select('id, grade_revision').eq('week_id', weekId).eq('student_id', studentId).maybeSingle()
  if (scoreError) return err('저장 버전을 확인하지 못했습니다.', 503)
  const scoreId = existingScore?.id ?? crypto.randomUUID()
  const customRules = promptRow?.content ?? undefined

  // 시험지에 인쇄된 전체 문항 목록 — 사진 일부가 안 보여도 OCR 목록이 중간에 끊기지 않게 앵커로 준다.
  // 예문 파트 번호는 단어 대신 null (문장 원문은 exampleItems 로 따로 전달 — 정답 오염 방지)
  const exampleNumbers = new Set(exampleItems.map((item) => item.number))
  const expectedItems: VocabOcrExpectedItem[] = gradingWords
    .map((w) => ({ number: w.number, word: exampleNumbers.has(w.number) ? null : (w.test_word ?? w.english_word) }))
    .sort((a, b) => a.number - b.number)

  let results
  try {
    results = await gradeVocabPhoto(fileData, mimeType, {
      correctAnswers: correctAnswerMap.size > 0 ? correctAnswerMap : undefined,
      customRules,
      exampleItems: exampleItems.length > 0 ? exampleItems : undefined,
      expectedItems: expectedItems.length > 0 ? expectedItems : undefined,
    })
  } catch (e) {
    console.error('[grade-vocab-photo] AI 채점 실패', e)
    return err('단어 채점 실패. 사진을 확인해주세요.', 422)
  }

  if (!results.length) {
    return err('단어를 찾을 수 없습니다', 422)
  }
  if (results.some((result) => !Number.isSafeInteger(result.number) || result.number < 1 || !result.english_word?.trim())) {
    return err('문항 번호를 정확히 읽지 못했습니다. 다시 촬영해주세요.', 422)
  }

  // Prepare the complete replacement before writing anything. Unknown/duplicate/missing items are not a partial success.
  const byNumber = new Map(gradingWords.map((word) => [word.number, word]))
  const byEnglish = new Map<string, VocabWordForGrading | null>()
  for (const word of gradingWords) {
    for (const key of new Set([word.english_word.toLowerCase(), (word.test_word ?? word.english_word).toLowerCase()])) {
      const previous = byEnglish.get(key)
      byEnglish.set(key, previous === undefined || previous?.id === word.id ? word : null)
    }
  }
  let unknownItem = false
  const answerInserts = results.flatMap((result) => {
    const word = byNumber.get(result.number) ?? byEnglish.get(result.english_word.toLowerCase())
    if (!word && gradingWords.length > 0) { unknownItem = true; return [] }
    return [{
      vocab_word_id: word?.id ?? null,
      vocab_word_variant_id: word?.vocab_word_variant_id ?? null,
      test_number: word?.number ?? result.number,
      test_word: word?.test_word ?? result.english_word,
      test_source: word?.test_source ?? (activeTest ? 'word' : null),
      student_answer: result.student_answer || null,
      is_correct: result.is_correct,
    }]
  })
  const savedIds = new Set(answerInserts.map((answer) => answer.vocab_word_id ?? `number:${answer.test_number}`))
  const missingNumbers = gradingWords.filter((word) => !savedIds.has(word.id)).map((word) => word.number).sort((a, b) => a - b)
  if (unknownItem || savedIds.size !== answerInserts.length || missingNumbers.length || (activeTest && !gradingWords.length)) {
    return err('일부 문항을 정확히 읽지 못해 기존 채점 결과를 유지했습니다. 답안지 전체가 보이도록 다시 촬영해주세요.', 422)
  }
  const newWords = gradingWords.length ? [] : results.map((result) => ({ number: result.number, english_word: result.english_word }))

  // Use a new object, so a failed commit never replaces the previously linked evidence photo.
  const photoPath = `${weekId}/${studentId}/${crypto.randomUUID()}`
  try {
    const bucket = supabase.storage.from('vocab-photos')
    const { error: uploadError } = await bucket.upload(photoPath, Buffer.from(fileData, 'base64'), { contentType: mimeType, upsert: false })
    if (uploadError) return err('사진 저장에 실패해 채점 결과를 저장하지 않았습니다. 다시 시도해주세요.', 503)
    const { data: photo, error: photoError } = await bucket.info(photoPath)
    if (photoError || !photo || !((photo.size ?? 0) > 0)) return err('사진 저장을 확인하지 못해 채점 결과를 저장하지 않았습니다.', 503)
  } catch {
    return err('사진 저장에 실패해 채점 결과를 저장하지 않았습니다. 다시 시도해주세요.', 503)
  }
  const { data: committed, error: saveError } = await supabase.rpc('save_week_vocab_grade', {
    p_week_id: weekId, p_student_id: studentId, p_score_id: scoreId,
    p_expected_revision: existingScore?.grade_revision ?? null, p_expected_test_id: activeTest?.id ?? null,
    p_words: newWords, p_answers: answerInserts, p_photo_path: photoPath,
  })
  if (saveError) return err(saveError.message, gradePersistenceStatus(saveError.code))
  if (!committed || typeof committed.vocab_correct !== 'number' || typeof committed.vocab_total !== 'number') {
    return err('채점 저장 결과를 확인하지 못했습니다. 새로고침 후 확인해주세요.', 503)
  }
  return ok({ ok: true, vocab_correct: committed.vocab_correct, vocab_total: committed.vocab_total, missing_numbers: [], results })
}
