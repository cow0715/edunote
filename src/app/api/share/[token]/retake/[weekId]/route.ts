import { createServiceClient } from '@/lib/supabase/server'
import { SHARE_CLOSED_ERROR, canViewShareByStudentId } from '@/lib/share-access'
import { NextResponse } from 'next/server'
import { gradeVocabItems } from '@/lib/anthropic'
import { buildWeekDisplayMap, type ClassPeriod } from '@/lib/class-periods'
import { gradeBlankAnswer, gradeChoiceAnswer } from '@/lib/vocab-blank-grading'
import { extractBlankAnswer, extractChoiceAnswerIndex, parseChoiceOptions } from '@/lib/vocab-example-blank'

// 재시험은 원 시험지 유형 그대로 다시 낸다.
//   뜻쓰기·유의어·반의어·파생어·예문뜻 → 텍스트(뜻) 입력, LLM 채점
//   예문빈칸 → 텍스트(영어) 입력, 코드 채점
//   예문선택 → 후보 2개 중 탭, 코드 채점
type RetakeKind = 'meaning' | 'blank' | 'choice'

function retakeKindOf(source: string | null | undefined): RetakeKind {
  if (source === 'example') return 'blank'
  if (source === 'example_choice') return 'choice'
  return 'meaning'
}

/** 예문빈칸/선택의 정답 영어를 원문·시험지 문장으로 역산 */
function exampleAnswerOf(kind: RetakeKind, exampleSentence: string | null | undefined, promptText: string | null | undefined, englishWord: string) {
  if (kind === 'blank') return extractBlankAnswer(exampleSentence, promptText) ?? englishWord
  if (kind === 'choice') {
    const index = extractChoiceAnswerIndex(exampleSentence, promptText)
    const options = parseChoiceOptions(promptText)
    return (index !== null && options ? options[index] : null) ?? englishWord
  }
  return null
}

export const maxDuration = 60

type Params = { token: string; weekId: string }

type VocabWordRow = {
  id: string
  number: number
  english_word: string
  correct_answer: string | null
  synonyms: string[] | null
  antonyms: string[] | null
  example_sentence: string | null
  example_translation: string | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

// ── GET: 아직 못 맞힌 단어만 반환 ────────────────────────────────────────────
async function hasActiveEnrollment(
  supabase: ReturnType<typeof createServiceClient>,
  studentId: string,
  classId: string,
) {
  const [{ data: enrollment }, { data: classRow }] = await Promise.all([
    supabase
      .from('class_student')
      .select('student_id')
      .eq('student_id', studentId)
      .eq('class_id', classId)
      .is('left_at', null)
      .maybeSingle(),
    supabase
      .from('class')
      .select('archived_at')
      .eq('id', classId)
      .maybeSingle(),
  ])

  return !!enrollment && !classRow?.archived_at
}

export async function GET(_: Request, { params }: { params: Promise<Params> }) {
  const supabase = createServiceClient()
  const { token, weekId } = await params

  const { data: student } = await supabase
    .from('student')
    .select('id, name')
    .eq('share_token', token)
    .single()
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })
  if (!await canViewShareByStudentId(supabase, student.id)) {
    return NextResponse.json({ error: SHARE_CLOSED_ERROR }, { status: 403 })
  }

  const { data: score } = await supabase
    .from('week_score')
    .select('id, vocab_retake_correct')
    .eq('week_id', weekId)
    .eq('student_id', student.id)
    .single()
  if (!score) return NextResponse.json({ error: '성적 데이터가 없습니다' }, { status: 404 })

  const { data: week } = await supabase
    .from('week')
    .select('id, week_number, start_date, vocab_total, class_id')
    .eq('id', weekId)
    .single()
  if (!week) return NextResponse.json({ error: '주차 정보가 없습니다' }, { status: 404 })
  if (!await hasActiveEnrollment(supabase, student.id, week.class_id)) {
    return NextResponse.json({ error: '공유가 종료되었습니다' }, { status: 403 })
  }

  const { data: classRow } = await supabase
    .from('class')
    .select('name')
    .eq('id', week.class_id)
    .single()

  const [{ data: periods }, { data: classWeeks }] = await Promise.all([
    supabase.from('class_period').select('*').eq('class_id', week.class_id).order('sort_order').order('start_date'),
    supabase.from('week').select('id, class_id, week_number, start_date').eq('class_id', week.class_id),
  ])
  const weekLabel = buildWeekDisplayMap(classWeeks ?? [], (periods ?? []) as ClassPeriod[]).get(week.id)?.displayLabel ?? `${week.week_number}주차`

  // 원본 오답 전체 조회
  const { data: wrongAnswers } = await supabase
    .from('student_vocab_answer')
    .select('id, test_number, test_word, test_source, retake_answer, retake_is_correct, vocab_word(id, number, english_word, correct_answer, synonyms, antonyms, example_sentence, example_translation), vocab_word_variant(word, meaning)')
    .eq('week_score_id', score.id)
    .eq('is_correct', false)
    .order('id')

  const { data: activeTest } = await supabase
    .from('vocab_test')
    .select('id')
    .eq('week_id', weekId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data: activeTestItems } = activeTest?.id
    ? await supabase
        .from('vocab_test_item')
        .select('vocab_word_id, test_number, prompt_text, prompt_source')
        .eq('vocab_test_id', activeTest.id)
    : { data: [] }
  const testItemByWordId = new Map((activeTestItems ?? []).map((item) => [item.vocab_word_id, item]))

  const allWrong = (wrongAnswers ?? [])
    .filter((a) => a.vocab_word)
    .map((a) => {
      const vw = one(a.vocab_word) as VocabWordRow
      const variant = one(a.vocab_word_variant) as { word: string; meaning: string | null } | null
      const testItem = testItemByWordId.get(vw.id)
      const testSource = a.test_source ?? testItem?.prompt_source ?? null
      const kind = retakeKindOf(testSource)
      const isExample = testSource === 'example' || testSource === 'example_meaning' || testSource === 'example_choice'
      const promptText = isExample ? (testItem?.prompt_text ?? null) : null
      return {
        answer_id: a.id,
        number: a.test_number ?? testItem?.test_number ?? vw.number,
        // 예문 유형은 english_word 에 원본 단어, prompt_text 에 문장
        english_word: isExample
          ? vw.english_word
          : (variant?.word ?? a.test_word ?? testItem?.prompt_text ?? vw.english_word),
        correct_answer: variant?.meaning ?? vw.correct_answer,
        test_source: testSource,
        kind,
        prompt_text: promptText,
        choice_options: kind === 'choice' ? parseChoiceOptions(promptText) : null,
        example_answer: exampleAnswerOf(kind, vw.example_sentence, promptText, vw.english_word),
        synonyms: vw.synonyms ?? null,
        antonyms: vw.antonyms ?? null,
        example_sentence: vw.example_sentence ?? null,
        example_translation: vw.example_translation ?? null,
        retake_answer: a.retake_answer ?? null,
        retake_is_correct: a.retake_is_correct ?? null,
      }
    })
    .sort((a, b) => a.number - b.number)

  // 아직 못 맞힌 단어만 출제 (null = 미응시, false = 틀림)
  const words = allWrong.filter((w) => w.retake_is_correct !== true)
  const completed = words.length === 0

  return NextResponse.json({
    student: { name: student.name },
    week: { week_number: week.week_number, display_label: weekLabel, class_name: classRow?.name ?? '', vocab_total: week.vocab_total },
    score_id: score.id,
    vocab_retake_correct: score.vocab_retake_correct,
    words,
    completed,
  })
}

// ── POST: 재시험 답안 제출 → AI 채점 → 저장 (무제한 반복 가능) ────────────────
export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  const supabase = createServiceClient()
  const { token, weekId } = await params

  const { data: student } = await supabase
    .from('student')
    .select('id')
    .eq('share_token', token)
    .single()
  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })
  if (!await canViewShareByStudentId(supabase, student.id)) {
    return NextResponse.json({ error: SHARE_CLOSED_ERROR }, { status: 403 })
  }

  const { data: score } = await supabase
    .from('week_score')
    .select('id')
    .eq('week_id', weekId)
    .eq('student_id', student.id)
    .single()
  if (!score) return NextResponse.json({ error: '성적 데이터가 없습니다' }, { status: 404 })

  const { data: week } = await supabase
    .from('week')
    .select('class_id')
    .eq('id', weekId)
    .single()
  if (!week) return NextResponse.json({ error: '주차 정보가 없습니다' }, { status: 404 })
  if (!await hasActiveEnrollment(supabase, student.id, week.class_id)) {
    return NextResponse.json({ error: '공유가 종료되었습니다' }, { status: 403 })
  }

  const { answers } = await request.json() as {
    answers: { answer_id: string; english_word: string; retake_answer: string }[]
  }
  if (!answers?.length) return NextResponse.json({ error: '답안 없음' }, { status: 400 })

  // vocab grading rules
  const { data: promptRow } = await supabase
    .from('prompts')
    .select('content')
    .eq('key', 'vocab_grading_rules')
    .maybeSingle()
  const customRules = promptRow?.content ?? undefined

  // 정답·유형 조회. 예문빈칸/선택은 활성 시험지 prompt_text 로 정답 영어를 역산한다
  const { data: answerDetails } = await supabase
    .from('student_vocab_answer')
    .select('id, test_source, vocab_word_id, vocab_word(english_word, correct_answer, example_sentence), vocab_word_variant(meaning)')
    .in('id', answers.map((a) => a.answer_id))

  const detailRows = (answerDetails ?? []) as unknown as Array<{
    id: string
    test_source: string | null
    vocab_word_id: string
    vocab_word: { english_word: string; correct_answer: string | null; example_sentence: string | null } | { english_word: string; correct_answer: string | null; example_sentence: string | null }[] | null
    vocab_word_variant: { meaning: string | null } | { meaning: string | null }[] | null
  }>

  const codeGradedRows = detailRows.filter((a) => retakeKindOf(a.test_source) !== 'meaning')
  const promptByWordId = new Map<string, string | null>()
  if (codeGradedRows.length > 0) {
    const { data: activeTest } = await supabase
      .from('vocab_test')
      .select('id')
      .eq('week_id', weekId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (activeTest) {
      const { data: testItems } = await supabase
        .from('vocab_test_item')
        .select('vocab_word_id, prompt_text')
        .eq('vocab_test_id', activeTest.id)
        .in('vocab_word_id', codeGradedRows.map((a) => a.vocab_word_id))
      for (const ti of testItems ?? []) promptByWordId.set(ti.vocab_word_id, ti.prompt_text)
    }
  }

  const detailById = new Map(detailRows.map((a) => {
    const vw = one(a.vocab_word)
    const variant = one(a.vocab_word_variant)
    const kind = retakeKindOf(a.test_source)
    const correct = kind === 'meaning'
      ? (variant?.meaning ?? vw?.correct_answer ?? null)
      : exampleAnswerOf(kind, vw?.example_sentence, promptByWordId.get(a.vocab_word_id), vw?.english_word ?? '')
    return [a.id, { kind, correct }] as const
  }))

  // 뜻 유형만 LLM, 나머지는 코드 채점
  const meaningAnswers = answers.filter((a) => detailById.get(a.answer_id)?.kind === 'meaning')
  const resultMap = new Map<string, boolean>()

  for (const a of answers) {
    const detail = detailById.get(a.answer_id)
    if (!detail || detail.kind === 'meaning') continue
    resultMap.set(a.answer_id, detail.kind === 'choice'
      ? gradeChoiceAnswer(a.retake_answer, detail.correct)
      : gradeBlankAnswer(a.retake_answer, detail.correct))
  }

  if (meaningAnswers.length > 0) {
    const gradingItems = meaningAnswers.map((a) => ({
      number: 0,
      english_word: a.english_word,
      student_answer: a.retake_answer || null,
      correct_answer: detailById.get(a.answer_id)?.correct ?? null,
    }))
    let graded: { number: number; english_word: string; student_answer: string | null; is_correct: boolean }[]
    try {
      graded = await gradeVocabItems(gradingItems, customRules)
    } catch (e) {
      console.error('[retake] AI 채점 실패', e)
      return NextResponse.json({ error: '채점 중 오류가 발생했습니다' }, { status: 500 })
    }
    graded.forEach((g, i) => resultMap.set(meaningAnswers[i].answer_id, g.is_correct))
  }

  // 채점 결과 저장 (이전 시도 덮어씌우기)
  await Promise.all(
    answers.map((a) => {
      const is_correct = resultMap.get(a.answer_id) ?? false
      return supabase
        .from('student_vocab_answer')
        .update({ retake_answer: a.retake_answer || null, retake_is_correct: is_correct })
        .eq('id', a.answer_id)
    })
  )

  // 전체 누적 통계 재계산
  const { data: allAnswersAfter } = await supabase
    .from('student_vocab_answer')
    .select('retake_is_correct')
    .eq('week_score_id', score.id)
    .eq('is_correct', false)

  const totalMastered = (allAnswersAfter ?? []).filter((a) => a.retake_is_correct === true).length
  const remaining = (allAnswersAfter ?? []).filter((a) => a.retake_is_correct !== true).length

  await supabase
    .from('week_score')
    .update({ vocab_retake_correct: totalMastered })
    .eq('id', score.id)

  const results = answers.map((a) => ({
    answer_id: a.answer_id,
    english_word: a.english_word,
    retake_answer: a.retake_answer,
    is_correct: resultMap.get(a.answer_id) ?? false,
  }))

  return NextResponse.json({
    ok: true,
    retake_correct: [...resultMap.values()].filter(Boolean).length,
    total: answers.length,
    results,
    remaining,
    total_mastered: totalMastered,
  })
}
