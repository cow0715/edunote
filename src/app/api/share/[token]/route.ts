import { createServiceClient } from '@/lib/supabase/server'
import { buildWeekDisplayMap, isWeekInPeriod, type ClassPeriod, type WeekForPeriod } from '@/lib/class-periods'
import { NextResponse } from 'next/server'

type ClassRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  academic_year: number | null
  school_name: string | null
  grade_level: number | null
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
    attendance: [],
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

  const { data: classStudents } = await supabase
    .from('class_student')
    .select('class_id, joined_at, left_at')
    .eq('student_id', student.id)

  const enrollments = (classStudents ?? []) as EnrollmentRow[]
  const allClassIds = [...new Set(enrollments.map((cs) => cs.class_id).filter(Boolean))]
  if (allClassIds.length === 0) return emptyShare(student)

  const { data: allClassRows } = await supabase
    .from('class')
    .select('id, name, start_date, end_date, academic_year, school_name, grade_level, archived_at')
    .in('id', allClassIds)

  const allClasses = (allClassRows ?? []) as ClassRow[]
  const classById = new Map(allClasses.map((c) => [c.id, c]))
  const activeClassIds = enrollments
    .filter((cs) => !cs.left_at && !classById.get(cs.class_id)?.archived_at)
    .map((cs) => cs.class_id)

  const { data: allPeriodsData } = await supabase
    .from('class_period')
    .select('*')
    .in('class_id', allClassIds)
    .order('sort_order')
    .order('start_date')

  const allPeriods = (allPeriodsData ?? []) as ClassPeriod[]
  const periodOptions = allPeriods.map((period) => ({
    id: period.id,
    class_id: period.class_id,
    class_name: classById.get(period.class_id)?.name ?? '',
    label: period.label,
    start_date: period.start_date,
    end_date: period.end_date,
    is_current: period.is_current,
    is_active_class: activeClassIds.includes(period.class_id),
  }))

  let selectedClassIds = activeClassIds
  let selectedPeriods = allPeriods.filter((period) =>
    selectedClassIds.includes(period.class_id) && period.is_current
  )

  if (periodId) {
    const selectedPeriod = allPeriods.find((period) => period.id === periodId)
    if (!selectedPeriod) return NextResponse.json({ error: '기간을 찾을 수 없습니다' }, { status: 404 })
    selectedClassIds = [selectedPeriod.class_id]
    selectedPeriods = [selectedPeriod]
  }

  if (selectedClassIds.length === 0) return emptyShare(student, periodOptions)

  const classes = allClasses.filter((c) => selectedClassIds.includes(c.id))

  const { data: rawWeeks } = await supabase
    .from('week')
    .select('*')
    .in('class_id', selectedClassIds)
    .order('week_number')

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

  const { data: allWeekScores } = weekIds.length > 0
    ? await supabase.from('week_score').select('week_id, reading_correct, vocab_correct').in('week_id', weekIds)
    : { data: [] }

  const { data: weekScores } = weekIds.length > 0
    ? await supabase
        .from('week_score')
        .select('*, vocab_retake_correct')
        .in('week_id', weekIds)
        .eq('student_id', student.id)
    : { data: [] }

  const scoreIds = (weekScores ?? []).map((s) => s.id)

  const { data: rawAnswers, error: answersError } = scoreIds.length > 0
    ? await supabase
        .from('student_answer')
        .select(`
          id, week_score_id, is_correct,
          student_answer, student_answer_text, ai_feedback,
          exam_question(
            id, week_id, question_number, sub_label,
            exam_type, question_style,
            correct_answer, correct_answer_text, explanation, question_text
          )
        `)
        .in('week_score_id', scoreIds)
    : { data: [] }

  const examQuestionIds = [...new Set(
    ((rawAnswers ?? []) as RawStudentAnswerRow[])
      .map((answer) => one(answer.exam_question)?.id)
      .filter(Boolean) as string[]
  )]
  const { data: questionTags } = examQuestionIds.length > 0
    ? await supabase
        .from('exam_question_tag')
        .select('exam_question_id, concept_tag(id, name, concept_category_id, concept_category(id, name))')
        .in('exam_question_id', examQuestionIds)
    : { data: [] }

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

  const { data: vocabAnswers } = scoreIds.length > 0
    ? await supabase
        .from('student_vocab_answer')
        .select('id, week_score_id, is_correct, student_answer, retake_answer, retake_is_correct, vocab_word(id, number, english_word, correct_answer, synonyms, antonyms, example_sentence, example_translation)')
        .in('week_score_id', scoreIds)
        .eq('is_correct', false)
    : { data: [] }

  const { data: attendanceRecords } = selectedClassIds.length > 0
    ? await supabase
        .from('attendance')
        .select('id, class_id, date, status')
        .in('class_id', selectedClassIds)
        .eq('student_id', student.id)
        .order('date', { ascending: false })
    : { data: [] }

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
    vocabAnswers: vocabAnswers ?? [],
    attendance: attendanceRecords ?? [],
    classAverages,
  })
}
