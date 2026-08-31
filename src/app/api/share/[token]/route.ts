import { createServiceClient } from '@/lib/supabase/server'
import { buildWeekDisplayMap, isWeekInPeriod, type ClassPeriod, type WeekForPeriod } from '@/lib/class-periods'
import { extractBlankAnswer, extractChoiceAnswerIndex, parseChoiceOptions } from '@/lib/vocab-example-blank'
import { SHARE_CLOSED_ERROR, loadShareAccess } from '@/lib/share-access'
import { NextResponse } from 'next/server'

type ClassRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  academic_year: number | null
  school_name: string | null
  grade_level: number | null
  class_type: 'regular' | 'special' | null
  archived_at: string | null
}

type EnrollmentRow = {
  class_id: string
  joined_at: string | null
  left_at: string | null
}

type ExamQuestionRow = {
  id: string
  week_id: string
  question_number: number
  sub_label: string | null
  exam_type: string | null
  question_style: string | null
  correct_answer: number | null
  correct_answer_text: string | null
  explanation: string | null
  question_text: string | null
  question_stem: string | null
  passage: string | null
  choices: string[] | null
  needs_source_image: boolean | null
  source_image_reason: string | null
  source_page: number | null
  source_image_path: string | null
}

type RawStudentAnswerRow = {
  exam_question: ExamQuestionRow | ExamQuestionRow[] | null
  [key: string]: unknown
}

type ConceptCategoryRow = { id: string; name: string }

type ConceptTagRow = {
  id: string
  name: string
  concept_category_id: string | null
  concept_category: ConceptCategoryRow | ConceptCategoryRow[] | null
}

type QuestionTagRow = {
  exam_question_id: string
  concept_tag: ConceptTagRow | ConceptTagRow[] | null
}

type WeekScoreAverageRow = {
  week_id: string
  reading_correct: number | null
  vocab_correct: number | null
}

type ShareWeekRow = WeekForPeriod & {
  vocab_total: number
  reading_total: number
  homework_total: number
  answer_sheet_path: string | null
  created_at: string
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function emptyShare(student: unknown, periodOptions: unknown[] = []) {
  return NextResponse.json({
    student,
    classes: [],
    currentPeriod: null,
    periodOptions,
    weeks: [],
    weekScores: [],
    studentAnswers: [],
    vocabAnswers: [],
    vocabWords: [],
    attendance: [],
    clinicAttendance: [],
    classAverages: {},
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = createServiceClient()
  const { token } = await params
  const periodId = new URL(request.url).searchParams.get('periodId')

  const { data: student } = await supabase
    .from('student')
    .select('*')
    .eq('share_token', token)
    .single()

  if (!student) return NextResponse.json({ error: '학생을 찾을 수 없습니다' }, { status: 404 })

  // 퇴원하면 링크가 즉시 죽는다. 단 데이터 범위는 퇴원한 반까지 포함한다 —
  // 정규반에 다니면서 지난 특강반 기록을 보는 경우가 정상이므로.
  const access = await loadShareAccess(supabase, student.id)
  if (!access.canView) {
    return NextResponse.json({ error: SHARE_CLOSED_ERROR }, { status: 403 })
  }

  const enrollments = access.enrollments as EnrollmentRow[]
  const allClassIds = [...new Set(enrollments.map((cs) => cs.class_id).filter(Boolean))]

  // 반 정보와 기간은 서로 무관 — 같이 던진다
  const [{ data: allClassRows }, { data: allPeriodsData }] = await Promise.all([
    supabase
      .from('class')
      .select('id, name, start_date, end_date, academic_year, school_name, grade_level, class_type, archived_at')
      .in('id', allClassIds),
    supabase
      .from('class_period')
      .select('*')
      .in('class_id', allClassIds)
      .order('sort_order')
      .order('start_date'),
  ])

  const allClasses = (allClassRows ?? []) as ClassRow[]
  const classById = new Map(allClasses.map((c) => [c.id, c]))
  const activeClassIds = enrollments
    .filter((cs) => !cs.left_at && !classById.get(cs.class_id)?.archived_at)
    .map((cs) => cs.class_id)

  if (activeClassIds.length === 0) {
    return NextResponse.json({ error: '공유가 종료되었습니다' }, { status: 403 })
  }

  const allPeriods = (allPeriodsData ?? []) as ClassPeriod[]
  const periodOptions = allPeriods.map((period) => ({
    id: period.id,
    class_id: period.class_id,
    class_name: classById.get(period.class_id)?.name ?? '',
    class_type: classById.get(period.class_id)?.class_type ?? 'regular',
    label: period.label,
    start_date: period.start_date,
    end_date: period.end_date,
    is_current: period.is_current,
    is_active_class: activeClassIds.includes(period.class_id),
  }))

  // 기본 화면은 정규반만 — 특강반은 기간 선택으로 전환 (정규반이 없으면 전체)
  const regularActiveClassIds = activeClassIds.filter(
    (id) => (classById.get(id)?.class_type ?? 'regular') === 'regular',
  )
  let selectedClassIds = regularActiveClassIds.length > 0 ? regularActiveClassIds : activeClassIds
  let selectedPeriods = allPeriods.filter((period) =>
    selectedClassIds.includes(period.class_id) && period.is_current
  )

  if (periodId) {
    const selectedPeriod = allPeriods.find((period) => period.id === periodId)
    if (!selectedPeriod) return NextResponse.json({ error: '기간을 찾을 수 없습니다' }, { status: 404 })
    if (!activeClassIds.includes(selectedPeriod.class_id)) {
      return NextResponse.json({ error: '공유가 종료되었습니다' }, { status: 403 })
    }
    selectedClassIds = [selectedPeriod.class_id]
    selectedPeriods = [selectedPeriod]
  }

  if (selectedClassIds.length === 0) return emptyShare(student, periodOptions)

  const classes = allClasses.filter((c) => selectedClassIds.includes(c.id))

  // 주차 목록과 출결 두 종류는 서로 무관 — 같이 던진다 (출결은 뒤쪽 응답 조립에서만 쓴다)
  const [{ data: rawWeeks }, { data: attendanceRecords }, { data: clinicAttendanceRecords }] = await Promise.all([
    supabase
      .from('week')
      .select('*')
      .in('class_id', selectedClassIds)
      .order('week_number'),
    supabase
      .from('attendance')
      .select('id, class_id, date, status')
      .in('class_id', selectedClassIds)
      .eq('student_id', student.id)
      .order('date', { ascending: false }),
    supabase
      .from('clinic_attendance')
      .select('id, clinic_slot_id, date, status, clinic_slot(weekday, starts_at, ends_at)')
      .eq('student_id', student.id)
      .eq('teacher_id', student.teacher_id)
      .order('date', { ascending: false }),
  ])

  const allSelectedWeeks = (rawWeeks ?? []) as ShareWeekRow[]

  const selectedPeriodByClassId = new Map(selectedPeriods.map((period) => [period.class_id, period]))
  const filteredWeeks = selectedPeriods.length > 0
    ? allSelectedWeeks.filter((week) => {
        const period = selectedPeriodByClassId.get(week.class_id)
        return period ? isWeekInPeriod(week, period) : false
      })
    : []

  const displayMap = buildWeekDisplayMap(
    allSelectedWeeks,
    allPeriods.filter((period) => selectedClassIds.includes(period.class_id)),
  )
  const weeks = filteredWeeks.map((week) => {
    const display = displayMap.get(week.id)
    return {
      ...week,
      display_label: display?.displayLabel ?? `${week.week_number}주차`,
      period_label: display?.periodLabel ?? null,
      period_week_number: display?.periodWeekNumber ?? null,
      class_period_id: display?.periodId ?? null,
    }
  })
  const weekIds = weeks.map((w) => w.id)

  // weekIds 만 있으면 되는 것들 — 서로 무관하므로 한 번에 던진다
  const emptyRows = <T,>() => Promise.resolve({ data: [] as T[] })
  const [
    { data: allWeekScores },
    { data: weekScores },
    { data: activeVocabTests },
    { data: vocabWords },
  ] = await Promise.all([
    weekIds.length > 0
      ? supabase.from('week_score').select('week_id, reading_correct, vocab_correct').in('week_id', weekIds)
      : emptyRows<{ week_id: string; reading_correct: number | null; vocab_correct: number | null }>(),
    weekIds.length > 0
      ? supabase
          .from('week_score')
          .select('*, vocab_retake_correct')
          .in('week_id', weekIds)
          .eq('student_id', student.id)
      : emptyRows<{ id: string }>(),
    weekIds.length > 0
      ? supabase
          .from('vocab_test')
          .select('id, week_id')
          .in('week_id', weekIds)
          .eq('is_active', true)
      : emptyRows<{ id: string; week_id: string }>(),
    weekIds.length > 0
      ? supabase
          .from('vocab_word')
          .select('id, week_id, number, passage_label, english_word, part_of_speech, correct_answer, synonyms, antonyms, derivatives, example_sentence, example_translation')
          .in('week_id', weekIds)
          .order('week_id')
          .order('number')
      : emptyRows<never>(),
  ])

  const scoreIds = (weekScores ?? []).map((s) => s.id)
  const activeVocabTestIds = (activeVocabTests ?? []).map((test) => test.id)

  // scoreIds·testIds 기반 — 역시 서로 무관
  const [
    { data: rawAnswers, error: answersError },
    { data: vocabAnswers },
    { data: activeVocabTestItems },
  ] = await Promise.all([
    scoreIds.length > 0
      ? supabase
        .from('student_answer')
        .select(`
          id, week_score_id, is_correct,
          student_answer, student_answer_text, ai_feedback,
          exam_question(
            id, week_id, question_number, sub_label,
            exam_type, question_style,
            correct_answer, correct_answer_text, explanation, question_text,
            question_stem, passage, choices,
            needs_source_image, source_image_reason, source_page, source_image_path
          )
        `)
        .in('week_score_id', scoreIds)
      : { data: [], error: null },
    scoreIds.length > 0
      ? supabase
          .from('student_vocab_answer')
          .select('id, week_score_id, is_correct, test_number, test_word, test_source, student_answer, retake_answer, retake_is_correct, vocab_word(id, week_id, number, passage_label, english_word, part_of_speech, correct_answer, synonyms, antonyms, derivatives, example_sentence, example_translation), vocab_word_variant(word, meaning, relation_type)')
          .in('week_score_id', scoreIds)
          .eq('is_correct', false)
      : emptyRows<never>(),
    activeVocabTestIds.length > 0
      ? supabase
          .from('vocab_test_item')
          .select('vocab_test_id, vocab_word_id, test_number, prompt_text, prompt_source')
          .in('vocab_test_id', activeVocabTestIds)
      : emptyRows<{ vocab_test_id: string; vocab_word_id: string; test_number: number | null; prompt_text: string | null; prompt_source: string | null }>(),
  ])

  const examQuestionIds = [...new Set(
    ((rawAnswers ?? []) as RawStudentAnswerRow[])
      .map((answer) => one(answer.exam_question)?.id)
      .filter(Boolean) as string[]
  )]
  const activeVocabTestIdSet = new Set(activeVocabTestIds)
  // 예문선택 오답 카드용: 두 후보(정답 + 오답)의 뜻. 오답 후보는 반의어 variant 또는 같은 주차 다른 단어라
  // 주차 내 variant·단어를 모아 "영어 → 뜻" 맵을 만든다 (선택형 문항이 있을 때만 조회)
  const choiceWordIds = (activeVocabTestItems ?? [])
    .filter((item) => activeVocabTestIdSet.has(item.vocab_test_id) && item.prompt_source === 'example_choice')
    .map((item) => item.vocab_word_id)
  const needChoiceMeanings = choiceWordIds.length > 0 && weekIds.length > 0

  // 문항 태그와 예문선택 뜻 조회는 서로 무관 — 마지막 배치로 한 번에
  const [{ data: questionTags }, { data: weekWords }, { data: weekVariants }] = await Promise.all([
    examQuestionIds.length > 0
      ? supabase
          .from('exam_question_tag')
          .select('exam_question_id, concept_tag(id, name, concept_category_id, concept_category(id, name))')
          .in('exam_question_id', examQuestionIds)
      : emptyRows<never>(),
    needChoiceMeanings
      ? supabase.from('vocab_word').select('english_word, correct_answer').in('week_id', weekIds)
      : emptyRows<{ english_word: string; correct_answer: string | null }>(),
    needChoiceMeanings
      ? supabase.from('vocab_word_variant').select('word, meaning, vocab_word!inner(week_id)').in('vocab_word.week_id', weekIds)
      : emptyRows<{ word: string; meaning: string | null }>(),
  ])

  const tagsByQuestionId = new Map<string, { concept_tag: { id: string; name: string; category_id: string | null; category_name: string | null } | null }[]>()
  for (const row of (questionTags ?? []) as QuestionTagRow[]) {
    const qid = row.exam_question_id
    const list = tagsByQuestionId.get(qid) ?? []
    const rawTag = one(row.concept_tag)
    const rawCat = rawTag ? one(rawTag.concept_category) : null
    list.push({ concept_tag: rawTag ? {
      id: rawTag.id,
      name: rawTag.name,
      category_id: rawTag.concept_category_id ?? null,
      category_name: rawCat?.name ?? null,
    } : null })
    tagsByQuestionId.set(qid, list)
  }

  if (answersError) console.error('[share] student_answer query error:', answersError)

  const studentAnswers = ((rawAnswers ?? []) as RawStudentAnswerRow[]).map((answer) => {
    const eq = one(answer.exam_question)
    return {
      ...answer,
      exam_question: eq
        ? { ...eq, exam_question_tag: tagsByQuestionId.get(eq.id) ?? [] }
        : null,
    }
  })

  const vocabTestItemByWordId = new Map(
    (activeVocabTestItems ?? [])
      .filter((item) => activeVocabTestIdSet.has(item.vocab_test_id))
      .map((item) => [item.vocab_word_id, item])
  )

  const wordMeaningByEnglish = new Map<string, string>()
  for (const w of (weekWords ?? []) as { english_word: string; correct_answer: string | null }[]) {
    if (w.correct_answer) wordMeaningByEnglish.set(w.english_word.trim().toLowerCase(), w.correct_answer)
  }
  for (const v of (weekVariants ?? []) as { word: string; meaning: string | null }[]) {
    // variant 뜻이 있으면 우선 (반의어는 vocab_word 에 없음)
    if (v.meaning) wordMeaningByEnglish.set(v.word.trim().toLowerCase(), v.meaning)
  }
  /** 굴절형 표면형(includes)으로도 뜻을 찾을 수 있게 원형 후보를 몇 개 시도 */
  const meaningOf = (english: string | null | undefined): string | null => {
    if (!english) return null
    const w = english.trim().toLowerCase()
    const candidates = [w]
    for (const suffix of ['ing', 'ed', 'es', 's', 'd']) {
      if (w.endsWith(suffix) && w.length > suffix.length + 1) {
        const stem = w.slice(0, -suffix.length)
        candidates.push(stem, `${stem}e`)
        if (stem.endsWith('i')) candidates.push(`${stem.slice(0, -1)}y`)
        if (stem.length > 1 && stem[stem.length - 1] === stem[stem.length - 2]) candidates.push(stem.slice(0, -1))
      }
    }
    for (const c of candidates) {
      const m = wordMeaningByEnglish.get(c)
      if (m) return m
    }
    return null
  }

  const displayVocabAnswers = ((vocabAnswers ?? []) as {
    test_number: number | null
    test_word: string | null
    test_source: string | null
    vocab_word: { id: string; english_word?: string; correct_answer?: string | null; example_sentence?: string | null } | { id: string; english_word?: string; correct_answer?: string | null; example_sentence?: string | null }[] | null
    vocab_word_variant?: { word: string; meaning: string | null; relation_type: string } | { word: string; meaning: string | null; relation_type: string }[] | null
  }[]).map((answer) => {
    const vocabWord = one(answer.vocab_word)
    const variant = one(answer.vocab_word_variant)
    const testItem = vocabWord ? vocabTestItemByWordId.get(vocabWord.id) : null
    const testSource = variant?.relation_type ?? answer.test_source ?? testItem?.prompt_source ?? null
    const isExample = testSource === 'example' || testSource === 'example_meaning' || testSource === 'example_choice'
    // 예문빈칸/선택은 정답이 영어 표면형. 원문과 시험지 문장을 비교해 역산한다
    let exampleAnswer: string | null = null
    let choiceMeanings: [string | null, string | null] | null = null
    if (testSource === 'example') {
      exampleAnswer = extractBlankAnswer(vocabWord?.example_sentence, testItem?.prompt_text) ?? vocabWord?.english_word ?? null
    } else if (testSource === 'example_choice') {
      const index = extractChoiceAnswerIndex(vocabWord?.example_sentence, testItem?.prompt_text)
      const options = parseChoiceOptions(testItem?.prompt_text)
      exampleAnswer = (index !== null && options ? options[index] : null) ?? vocabWord?.english_word ?? null
      if (options) {
        // 정답 후보의 뜻은 단어 자체의 뜻을 우선 사용 (variant 맵보다 정확)
        choiceMeanings = [
          index === 0 ? (vocabWord?.correct_answer ?? meaningOf(options[0])) : meaningOf(options[0]),
          index === 1 ? (vocabWord?.correct_answer ?? meaningOf(options[1])) : meaningOf(options[1]),
        ]
      }
    }
    return {
      ...answer,
      vocab_word: vocabWord && variant?.meaning
        ? { ...vocabWord, correct_answer: variant.meaning }
        : vocabWord,
      test_number: answer.test_number ?? testItem?.test_number ?? null,
      test_word: isExample
        ? (answer.test_word ?? vocabWord?.english_word ?? null)
        : (variant?.word ?? answer.test_word ?? testItem?.prompt_text ?? null),
      test_source: testSource,
      test_prompt: isExample ? (testItem?.prompt_text ?? null) : null,
      example_answer: exampleAnswer,
      choice_meanings: choiceMeanings,
    }
  })

  const weekById = new Map(weeks.map((w) => [w.id, w]))
  const classAverages: Record<string, { readingRate: number | null; vocabRate: number | null }> = {}
  for (const weekId of weekIds) {
    const w = weekById.get(weekId)
    if (!w) continue
    const wScores = ((allWeekScores ?? []) as WeekScoreAverageRow[]).filter((s) => s.week_id === weekId)
    const rRates = wScores.filter((s) => s.reading_correct !== null && w.reading_total > 0)
      .map((s) => (s.reading_correct! / w.reading_total) * 100)
    const vRates = wScores.filter((s) => s.vocab_correct !== null && w.vocab_total > 0)
      .map((s) => (s.vocab_correct! / w.vocab_total) * 100)
    classAverages[weekId] = {
      readingRate: rRates.length > 0 ? Math.round(rRates.reduce((a: number, b: number) => a + b, 0) / rRates.length) : null,
      vocabRate: vRates.length > 0 ? Math.round(vRates.reduce((a: number, b: number) => a + b, 0) / vRates.length) : null,
    }
  }

  const currentPeriod = selectedPeriods[0]
  const contextClass = classes.length === 1 ? classes[0] : null
  const studentForShare = {
    ...student,
    school: contextClass?.school_name ?? student.school,
    grade: contextClass?.grade_level ? `${contextClass.grade_level}학년` : student.grade,
  }

  return NextResponse.json({
    student: studentForShare,
    classes,
    currentPeriod: currentPeriod ? {
      id: currentPeriod.id,
      class_id: currentPeriod.class_id,
      label: currentPeriod.label,
      start_date: currentPeriod.start_date,
      end_date: currentPeriod.end_date,
      is_current: currentPeriod.is_current,
    } : null,
    periodOptions,
    weeks,
    weekScores: weekScores ?? [],
    studentAnswers,
    vocabAnswers: displayVocabAnswers,
    vocabWords: vocabWords ?? [],
    attendance: attendanceRecords ?? [],
    clinicAttendance: clinicAttendanceRecords ?? [],
    classAverages,
  })
}
