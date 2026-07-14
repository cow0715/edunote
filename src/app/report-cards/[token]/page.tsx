import { notFound } from 'next/navigation'
import { ReportCardPreview } from '@/components/report-cards/report-card-preview'
import { computeMetrics, getPreviousPeriod, type AcademyProfile, type PeriodComparison, type PeriodType } from '@/lib/report-card'
import { createServiceClient } from '@/lib/supabase/server'

type ReportClassRow = {
  id: string
  name: string
  academic_year: number | null
  school_name: string | null
  grade_level: number | null
}

export default async function PublicReportCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: card } = await supabase
    .from('report_card')
    .select('*')
    .eq('share_token', token)
    .eq('status', 'published')
    .is('revoked_at', null)
    .single()

  if (!card) notFound()

  const { data: student } = await supabase
    .from('student')
    .select('id, name, school, grade, student_code')
    .eq('id', card.student_id)
    .single()

  if (!student) notFound()

  const { data: teacherRow } = await supabase
    .from('teacher')
    .select('name, academy_name, academy_english_name, academy_address, academy_phone, director_name')
    .eq('id', card.teacher_id)
    .single()

  const academy: AcademyProfile = {
    name: teacherRow?.academy_name ?? null,
    english_name: teacherRow?.academy_english_name ?? null,
    address: teacherRow?.academy_address ?? null,
    phone: teacherRow?.academy_phone ?? null,
    director_name: teacherRow?.director_name ?? null,
    teacher_name: teacherRow?.name ?? null,
  }

  // 반별 성적표(class_id 지정)는 해당 반만, 레거시(null)는 전체 합산
  const cardClassId = (card.class_id ?? null) as string | null
  const { data: classStudents } = await supabase
    .from('class_student')
    .select('class_id')
    .eq('student_id', student.id)

  const classIds = cardClassId
    ? [cardClassId]
    : (classStudents ?? []).map((cs: { class_id: string }) => cs.class_id)
  const { data: classRows } = classIds.length > 0
    ? await supabase.from('class').select('id, name, academic_year, school_name, grade_level').in('id', classIds)
    : { data: [] as ReportClassRow[] }
  const reportClasses = (classRows ?? []) as ReportClassRow[]
  const classById = new Map(reportClasses.map((c) => [c.id, c]))
  const classNameById = new Map(reportClasses.map((c) => [c.id, c.name]))

  const { data: weeks } = classIds.length > 0
    ? await supabase
        .from('week')
        .select('id, class_id, week_number, start_date, reading_total, vocab_total, homework_total, created_at')
        .in('class_id', classIds)
    : { data: [] }

  const periodStart = card.period_start
  const periodEnd = card.period_end
  const inPeriod = (weeks ?? []).filter((w: { start_date: string | null; created_at: string }) => {
    const ref = w.start_date ?? w.created_at.slice(0, 10)
    return ref >= periodStart && ref <= periodEnd
  })

  const classWeekCounts = new Map<string, number>()
  for (const w of inPeriod as { class_id: string }[]) {
    classWeekCounts.set(w.class_id, (classWeekCounts.get(w.class_id) ?? 0) + 1)
  }
  const primaryClassId = [...classWeekCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const primaryClass = primaryClassId ? classById.get(primaryClassId) : null
  const studentForReport = {
    ...student,
    school: primaryClass?.school_name ?? student.school,
    grade: primaryClass?.grade_level ? `${primaryClass.grade_level}학년` : student.grade,
  }

  const weekIds = inPeriod.map((w: { id: string }) => w.id)
  const { data: scores } = weekIds.length > 0
    ? await supabase
        .from('week_score')
        .select('id, week_id, reading_correct, vocab_correct, homework_done')
        .in('week_id', weekIds)
        .eq('student_id', student.id)
    : { data: [] }

  const scoreIds = (scores ?? []).map((s: { id: string }) => s.id)
  const { data: rawAnswers } = scoreIds.length > 0
    ? await supabase
        .from('student_answer')
        .select(`
          id, week_score_id, is_correct,
          student_answer, student_answer_text,
          exam_question(
            id, week_id, question_number, sub_label,
            exam_type, question_style,
            correct_answer, correct_answer_text, explanation, question_text,
            question_stem, passage, choices
          )
        `)
        .in('week_score_id', scoreIds)
    : { data: [] }

  const examQuestionIds = [...new Set(
    (rawAnswers ?? [])
      .map((a: { exam_question: unknown }) => {
        const eq = Array.isArray(a.exam_question) ? a.exam_question[0] : a.exam_question
        return (eq as { id?: string } | null)?.id
      })
      .filter(Boolean) as string[],
  )]

  const { data: questionTags } = examQuestionIds.length > 0
    ? await supabase
        .from('exam_question_tag')
        .select('exam_question_id, concept_tag(id, name, concept_category_id, concept_category(id, name))')
        .in('exam_question_id', examQuestionIds)
    : { data: [] }

  const tagsByQ = new Map<string, { concept_tag: { id: string; name: string; category_id: string | null; category_name: string | null } | null }[]>()
  for (const t of questionTags ?? []) {
    const row = t as { exam_question_id: string; concept_tag: unknown }
    const qid = row.exam_question_id
    const list = tagsByQ.get(qid) ?? []
    const rawTag = Array.isArray(row.concept_tag)
      ? row.concept_tag[0]
      : row.concept_tag as { id: string; name: string; concept_category_id: string | null; concept_category: unknown } | null
    const rawCat = rawTag
      ? (Array.isArray(rawTag.concept_category) ? rawTag.concept_category[0] : rawTag.concept_category) as { id: string; name: string } | null
      : null
    list.push({ concept_tag: rawTag ? {
      id: rawTag.id,
      name: rawTag.name,
      category_id: rawTag.concept_category_id ?? null,
      category_name: rawCat?.name ?? null,
    } : null })
    tagsByQ.set(qid, list)
  }

  const answers = (rawAnswers ?? []).map((a: { exam_question: unknown; [k: string]: unknown }) => {
    const eq = (Array.isArray(a.exam_question) ? a.exam_question[0] : a.exam_question) as { id: string; [k: string]: unknown } | null
    return {
      ...a,
      exam_question: eq ? { ...eq, exam_question_tag: tagsByQ.get(eq.id) ?? [] } : null,
    }
  })

  const { data: attendance } = classIds.length > 0
    ? await supabase
        .from('attendance')
        .select('status, date')
        .in('class_id', classIds)
        .eq('student_id', student.id)
        .gte('date', periodStart)
        .lte('date', periodEnd)
    : { data: [] }

  const metrics = computeMetrics(
    inPeriod as Parameters<typeof computeMetrics>[0],
    (scores ?? []) as Parameters<typeof computeMetrics>[1],
    answers as Parameters<typeof computeMetrics>[2],
    (attendance ?? []) as Parameters<typeof computeMetrics>[3],
    classNameById,
  )

  const prevRange = getPreviousPeriod(card.period_type as PeriodType, card.period_start)
  const prevWeeks = (weeks ?? []).filter((w: { start_date: string | null; created_at: string }) => {
    const ref = w.start_date ?? w.created_at.slice(0, 10)
    return ref >= prevRange.start && ref <= prevRange.end
  })
  const prevWeekIds = prevWeeks.map((w: { id: string }) => w.id)
  const { data: prevScores } = prevWeekIds.length > 0
    ? await supabase
        .from('week_score')
        .select('id, week_id, reading_correct, vocab_correct, homework_done')
        .in('week_id', prevWeekIds)
        .eq('student_id', student.id)
    : { data: [] }

  const prevMetrics = computeMetrics(
    prevWeeks as Parameters<typeof computeMetrics>[0],
    (prevScores ?? []) as Parameters<typeof computeMetrics>[1],
    [],
    [],
    classNameById,
  )
  const previous: PeriodComparison | null = prevMetrics.weekRows.length > 0 ? {
    label: prevRange.label,
    overallAvg: prevMetrics.overallAvg,
    avgReading: prevMetrics.avgReading,
    avgVocab: prevMetrics.avgVocab,
    avgHomework: prevMetrics.avgHomework,
  } : null

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#EBF3FF] to-white px-3 py-4 sm:px-4 sm:py-6">
      <ReportCardPreview
        student={studentForReport}
        card={card}
        metrics={metrics}
        previous={previous}
        academy={academy}
        classContext={null}
        displayMode="mobile"
        cardClassName={cardClassId ? classNameById.get(cardClassId) ?? null : null}
      />
    </main>
  )
}
