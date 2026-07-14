import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { assertMockExamOwner } from '@/lib/mock-exam-server'
import { getMonthlyPeriod } from '@/lib/report-card'
import { sendMessages, type SendTarget } from '@/lib/solapi'

type DispatchKind = 'monthly' | 'mock'
type RecipientKey = 'mother' | 'father' | 'student'

type StudentPhone = {
  id: string
  name: string
  phone: string | null
  mother_phone: string | null
  father_phone: string | null
  school: string | null
  grade: string | null
}

type ReportCardRow = {
  id: string
  student_id: string
  class_id: string | null
  status: 'draft' | 'published'
  period_label: string
  share_token: string
}

type DispatchClass = {
  id: string
  name: string
  class_type: 'regular' | 'special'
}

type MockReportRow = {
  id: string
  share_token: string
  status: 'published' | 'revoked'
}

type MockResultRow = {
  id: string
  student_id: string
  raw_score: number | null
  grade: number | null
  student?: StudentPhone | StudentPhone[] | null
  mock_exam_report?: MockReportRow | MockReportRow[] | null
}

type MockExamRow = {
  id: string
  title: string
  exam_year: number
  exam_month: number
  grade: number | null
  source: string
  exam_date: string | null
}

type ResultForSnapshot = {
  id: string
  mock_exam_id: string
  student_id: string
  raw_score: number | null
  grade: number | null
  listening_correct: number
  listening_total: number
  reading_correct: number
  reading_total: number
  type_analysis: Record<string, unknown>
  teacher_comment: string | null
  student?: { id: string; name: string; school: string | null; grade: string | null } | { id: string; name: string; school: string | null; grade: string | null }[] | null
  mock_exam?: MockExamRow | MockExamRow[] | null
  mock_exam_student_answer?: {
    student_answer: string | null
    is_correct: boolean
    earned_points: number
    mock_exam_question?: {
      question_number: number
      correct_answer: string
      points: number
      section: string
      question_type: string
      difficulty: string
      is_void: boolean
      all_correct: boolean
    } | {
      question_number: number
      correct_answer: string
      points: number
      section: string
      question_type: string
      difficulty: string
      is_void: boolean
      all_correct: boolean
    }[] | null
  }[]
}

type DispatchBody = {
  kind?: DispatchKind
  action?: 'publish' | 'send'
  year?: number
  month?: number
  class_id?: string
  mock_exam_id?: string
  student_ids?: string[]
  pairs?: { student_id: string; class_id: string }[]
  result_ids?: string[]
  recipients?: RecipientKey[]
  message_template?: string
  include_resend?: boolean
}

type DispatchTargetMeta = {
  kind: DispatchKind
  studentId: string
  reportCardId?: string
  mockExamId?: string
  mockExamReportId?: string
  recipientLabel: string
  phone: string
  message: string
}

const RECIPIENT_LABEL: Record<RecipientKey, string> = {
  mother: '어머니',
  father: '아버지',
  student: '학생',
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function reportList(value: MockReportRow | MockReportRow[] | null | undefined) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function phoneFor(student: StudentPhone, recipient: RecipientKey) {
  if (recipient === 'mother') return student.mother_phone
  if (recipient === 'father') return student.father_phone
  return student.phone
}

function renderMonthlyMessage(template: string, args: { studentName: string; periodLabel: string; className: string; reportUrl: string }) {
  return template
    .replaceAll('{학생명}', args.studentName)
    .replaceAll('{기간명}', args.periodLabel)
    .replaceAll('{수업명}', args.className)
    .replaceAll('{성적표링크}', args.reportUrl)
}

function renderMockMessage(template: string, args: { studentName: string; examTitle: string; reportUrl: string }) {
  return template
    .replaceAll('{학생명}', args.studentName)
    .replaceAll('{시험명}', args.examTitle)
    .replaceAll('{성적표링크}', args.reportUrl)
}

async function publishMockExamReport(supabase: Awaited<ReturnType<typeof getAuth>>['supabase'], mockExamId: string, resultId: string) {
  const { data, error } = await supabase
    .from('mock_exam_result')
    .select(`
      *,
      student(id, name, school, grade),
      mock_exam(id, title, exam_year, exam_month, grade, source, exam_date),
      mock_exam_student_answer(
        student_answer, is_correct, earned_points,
        mock_exam_question(question_number, correct_answer, points, section, question_type, difficulty, is_void, all_correct)
      )
    `)
    .eq('id', resultId)
    .eq('mock_exam_id', mockExamId)
    .single()

  if (error || !data) throw new Error(error?.message ?? '성적 결과를 찾을 수 없습니다')

  const result = data as unknown as ResultForSnapshot
  const exam = one(result.mock_exam)
  const student = one(result.student)
  if (!exam || !student) throw new Error('성적표 링크 생성에 필요한 정보가 부족합니다')

  const wrongAnswers = (result.mock_exam_student_answer ?? [])
    .map((answer) => ({
      ...answer,
      mock_exam_question: one(answer.mock_exam_question),
    }))
    .filter((answer) => answer.mock_exam_question && !answer.mock_exam_question.is_void && !answer.is_correct)
    .sort((a, b) => (a.mock_exam_question?.question_number ?? 0) - (b.mock_exam_question?.question_number ?? 0))

  const snapshot = {
    version: 1,
    generated_at: new Date().toISOString(),
    exam,
    student,
    score: {
      raw_score: result.raw_score,
      grade: result.grade,
      listening_correct: result.listening_correct,
      listening_total: result.listening_total,
      reading_correct: result.reading_correct,
      reading_total: result.reading_total,
      type_analysis: result.type_analysis,
    },
    cohort: null,
    wrong_answers: wrongAnswers,
    teacher_comment: result.teacher_comment,
  }

  const { data: report, error: reportError } = await supabase
    .from('mock_exam_report')
    .upsert({
      mock_exam_result_id: result.id,
      snapshot_json: snapshot,
      status: 'published',
      published_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: 'mock_exam_result_id' })
    .select('id, share_token, status')
    .single()

  if (reportError) throw new Error(reportError.message)

  await supabase
    .from('mock_exam_result')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', result.id)

  return report as MockReportRow
}

async function getActiveStudents(supabase: Awaited<ReturnType<typeof getAuth>>['supabase'], teacherId: string, classId: string | null) {
  const { data, error } = await supabase
    .from('student')
    .select('id, name, phone, mother_phone, father_phone, school, grade, class_student(class_id, left_at, class(id, name, archived_at, grade_level, class_type))')
    .eq('teacher_id', teacherId)
    .order('name')

  if (error) throw new Error(error.message)

  type ClassJoin = { id: string; name: string; archived_at: string | null; grade_level: number | null; class_type: 'regular' | 'special' | null }
  return ((data ?? []) as unknown as (StudentPhone & {
    class_student?: { class_id: string; left_at: string | null; class?: ClassJoin | ClassJoin[] | null }[]
  })[])
    .map((student) => {
      const active_classes: DispatchClass[] = (student.class_student ?? [])
        .filter((enrollment) => {
          const classRow = one(enrollment.class)
          return !enrollment.left_at && classRow && !classRow.archived_at && (!classId || enrollment.class_id === classId)
        })
        .map((enrollment) => {
          const classRow = one(enrollment.class)!
          return { id: enrollment.class_id, name: classRow.name, class_type: classRow.class_type ?? 'regular' }
        })
        .sort((a, b) => (a.class_type === b.class_type ? a.name.localeCompare(b.name, 'ko') : a.class_type === 'regular' ? -1 : 1))
      return { ...student, active_classes }
    })
    .filter((student) => student.active_classes.length > 0)
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증이 필요합니다', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const searchParams = new URL(request.url).searchParams
  const kind = searchParams.get('kind') as DispatchKind | null
  const origin = new URL(request.url).origin

  try {
    if (kind === 'monthly') {
      const year = Number(searchParams.get('year'))
      const month = Number(searchParams.get('month'))
      const classId = searchParams.get('class_id')
      if (!year || !month) return err('year, month가 필요합니다')

      const period = getMonthlyPeriod(year, month)
      const students = await getActiveStudents(supabase, teacherId, classId && classId !== 'all' ? classId : null)
      const studentIds = students.map((student) => student.id)
      const { data: cards } = studentIds.length > 0
        ? await supabase
            .from('report_card')
            .select('id, student_id, class_id, status, period_label, share_token')
            .eq('teacher_id', teacherId)
            .eq('period_type', 'monthly')
            .eq('period_start', period.start)
            .eq('period_end', period.end)
            .in('student_id', studentIds)
        : { data: [] }
      // 반별 카드(class_id 있음)만 발송 관리 대상 — 레거시(null) 카드는 무시
      const cardByKey = new Map(
        ((cards ?? []) as ReportCardRow[])
          .filter((card) => card.class_id)
          .map((card) => [`${card.student_id}:${card.class_id}`, card]),
      )
      const cardIds = [...cardByKey.values()].map((card) => card.id)
      const { data: logs } = cardIds.length > 0
        ? await supabase
            .from('message_log')
            .select('report_card_id, phone, status')
            .in('report_card_id', cardIds)
            .eq('status', 'sent')
        : { data: [] }
      const sentByReportId = new Map<string, number>()
      for (const log of logs ?? []) {
        const row = log as { report_card_id: string | null }
        if (!row.report_card_id) continue
        sentByReportId.set(row.report_card_id, (sentByReportId.get(row.report_card_id) ?? 0) + 1)
      }

      return ok({
        kind,
        period,
        items: students.flatMap((student) => student.active_classes.map((cls) => {
          const card = cardByKey.get(`${student.id}:${cls.id}`) ?? null
          return {
            student,
            class: cls,
            report_id: card?.id ?? null,
            report_status: card?.status ?? 'missing',
            report_url: card ? `${origin}/report-cards/${card.share_token}` : null,
            sent_count: card ? sentByReportId.get(card.id) ?? 0 : 0,
            recipients: {
              mother: !!student.mother_phone,
              father: !!student.father_phone,
              student: !!student.phone,
            },
          }
        })),
      })
    }

    if (kind === 'mock') {
      const mockExamId = searchParams.get('mock_exam_id')
      const classId = searchParams.get('class_id')
      if (!mockExamId) return err('mock_exam_id가 필요합니다')
      if (!(await assertMockExamOwner(supabase, mockExamId, teacherId))) return err('접근 권한이 없습니다', 403)

      const [{ data: exam }, { data: results, error: resultError }] = await Promise.all([
        supabase.from('mock_exam').select('id, title, exam_year, exam_month, grade, source, exam_date').eq('id', mockExamId).single(),
        supabase
          .from('mock_exam_result')
          .select('id, student_id, raw_score, grade, student(id, name, phone, mother_phone, father_phone, school, grade), mock_exam_report(id, share_token, status)')
          .eq('mock_exam_id', mockExamId)
          .order('raw_score', { ascending: false }),
      ])
      if (!exam) return err('모의고사를 찾을 수 없습니다', 404)
      if (resultError) return err(resultError.message, 500)

      let filteredResults = (results ?? []) as unknown as MockResultRow[]
      if (classId && classId !== 'all') {
        const studentIds = [...new Set(filteredResults.map((result) => result.student_id).filter(Boolean))]
        const { data: enrollments, error: enrollmentError } = studentIds.length > 0
          ? await supabase
              .from('class_student')
              .select('student_id')
              .eq('class_id', classId)
              .is('left_at', null)
              .in('student_id', studentIds)
          : { data: [], error: null }
        if (enrollmentError) return err(enrollmentError.message, 500)
        const classStudentIds = new Set((enrollments ?? []).map((row: { student_id: string }) => row.student_id))
        filteredResults = filteredResults.filter((result) => classStudentIds.has(result.student_id))
      }

      const reportIds = filteredResults
        .map((result) => reportList(result.mock_exam_report).find((report) => report.status === 'published')?.id)
        .filter(Boolean) as string[]
      const { data: logs } = reportIds.length > 0
        ? await supabase
            .from('message_log')
            .select('mock_exam_report_id, phone, status')
            .in('mock_exam_report_id', reportIds)
            .eq('status', 'sent')
        : { data: [] }
      const sentByReportId = new Map<string, number>()
      for (const log of logs ?? []) {
        const row = log as { mock_exam_report_id: string | null }
        if (!row.mock_exam_report_id) continue
        sentByReportId.set(row.mock_exam_report_id, (sentByReportId.get(row.mock_exam_report_id) ?? 0) + 1)
      }

      return ok({
        kind,
        exam,
        items: filteredResults.map((result) => {
          const student = one(result.student)
          const report = reportList(result.mock_exam_report).find((item) => item.status === 'published') ?? null
          return {
            result_id: result.id,
            student,
            raw_score: result.raw_score,
            grade: result.grade,
            report_id: report?.id ?? null,
            report_status: report ? 'published' : 'missing',
            report_url: report ? `${origin}/mock-exam-reports/${report.share_token}` : null,
            sent_count: report ? sentByReportId.get(report.id) ?? 0 : 0,
            recipients: student ? {
              mother: !!student.mother_phone,
              father: !!student.father_phone,
              student: !!student.phone,
            } : { mother: false, father: false, student: false },
          }
        }),
      })
    }

    return err('kind가 올바르지 않습니다')
  } catch (error) {
    return err(error instanceof Error ? error.message : '발송 대상 조회 실패', 500)
  }
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증이 필요합니다', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const body = await request.json().catch(() => ({})) as DispatchBody
  const kind = body.kind
  const action = body.action ?? 'send'
  const recipients = [...new Set(body.recipients ?? ['mother', 'student'])].filter((key): key is RecipientKey => (
    key === 'mother' || key === 'father' || key === 'student'
  ))
  const template = body.message_template?.trim()

  if (!kind) return err('kind가 필요합니다')
  if (action !== 'publish' && recipients.length === 0) return err('수신자를 선택해 주세요')
  if (action !== 'publish' && !template) return err('문자 내용을 입력해 주세요')
  if (action !== 'publish' && !template?.includes('{성적표링크}')) return err('문자 내용에 {성적표링크}를 포함해 주세요')

  const origin = new URL(request.url).origin
  const targets: SendTarget[] = []
  const metas: DispatchTargetMeta[] = []
  const skipped: { id: string; student_name?: string; reason: string }[] = []

  try {
    if (kind === 'monthly') {
      const year = Number(body.year)
      const month = Number(body.month)
      if (!year || !month) return err('year, month가 필요합니다')

      // 발송 단위: 학생×반(pairs). student_ids만 오면 활성 반으로 확장 (하위 호환)
      let pairs = (body.pairs ?? []).filter((pair) => pair?.student_id && pair?.class_id)
      if (pairs.length === 0) {
        const studentIds = [...new Set(body.student_ids ?? [])].filter(Boolean)
        if (studentIds.length === 0) return err('전송할 학생을 선택해 주세요')
        const activeStudents = await getActiveStudents(supabase, teacherId, null)
        const activeById = new Map(activeStudents.map((student) => [student.id, student]))
        pairs = studentIds.flatMap((studentId) =>
          (activeById.get(studentId)?.active_classes ?? []).map((cls) => ({ student_id: studentId, class_id: cls.id })))
      }
      pairs = [...new Map(pairs.map((pair) => [`${pair.student_id}:${pair.class_id}`, pair])).values()]
      if (pairs.length === 0) return err('전송할 학생을 선택해 주세요')

      const period = getMonthlyPeriod(year, month)
      const studentIds = [...new Set(pairs.map((pair) => pair.student_id))]
      const pairClassIds = [...new Set(pairs.map((pair) => pair.class_id))]

      const [studentQuery, classQuery] = await Promise.all([
        supabase
          .from('student')
          .select('id, name, phone, mother_phone, father_phone, school, grade')
          .eq('teacher_id', teacherId)
          .in('id', studentIds),
        supabase
          .from('class')
          .select('id, name, class_type')
          .eq('teacher_id', teacherId)
          .in('id', pairClassIds),
      ])
      if (studentQuery.error) return err(studentQuery.error.message, 500)
      if (classQuery.error) return err(classQuery.error.message, 500)
      const students = studentQuery.data
      const classById = new Map(((classQuery.data ?? []) as DispatchClass[]).map((cls) => [cls.id, cls]))
      pairs = pairs.filter((pair) => classById.has(pair.class_id))
      if (pairs.length === 0) return err('전송할 학생을 선택해 주세요')

      const selectCards = () => supabase
        .from('report_card')
        .select('id, student_id, class_id, status, period_label, share_token')
        .eq('teacher_id', teacherId)
        .eq('period_type', 'monthly')
        .eq('period_start', period.start)
        .eq('period_end', period.end)
        .in('student_id', studentIds)
      const buildCardMap = (rows: unknown[] | null) => new Map(
        ((rows ?? []) as ReportCardRow[])
          .filter((card) => card.class_id)
          .map((card) => [`${card.student_id}:${card.class_id}`, card]),
      )

      const cardQuery = await selectCards()
      if (cardQuery.error) return err(cardQuery.error.message, 500)
      let cardByKey = buildCardMap(cardQuery.data)

      const missingRows = pairs
        .filter((pair) => !cardByKey.has(`${pair.student_id}:${pair.class_id}`))
        .map((pair) => ({
          teacher_id: teacherId,
          student_id: pair.student_id,
          class_id: pair.class_id,
          period_type: 'monthly',
          period_start: period.start,
          period_end: period.end,
          period_label: period.label,
          highlighted_wrong_ids: [],
          status: 'draft',
        }))

      if (missingRows.length > 0) {
        const { error: insertError } = await supabase.from('report_card').insert(missingRows)
        if (insertError) return err(insertError.message, 500)
        const refetch = await selectCards()
        if (refetch.error) return err(refetch.error.message, 500)
        cardByKey = buildCardMap(refetch.data)
      }

      const selectedCards = pairs
        .map((pair) => cardByKey.get(`${pair.student_id}:${pair.class_id}`))
        .filter(Boolean) as ReportCardRow[]
      const cardIds = selectedCards.map((card) => card.id)
      if (cardIds.length > 0) {
        const { error: publishError } = await supabase
          .from('report_card')
          .update({ status: 'published', published_at: new Date().toISOString(), revoked_at: null })
          .eq('teacher_id', teacherId)
          .in('id', cardIds)
        if (publishError) return err(publishError.message, 500)
      }

      if (action === 'publish') {
        return ok({
          published_count: cardIds.length,
          created_count: missingRows.length,
        })
      }

      const { data: sentLogs } = cardIds.length > 0
        ? await supabase
            .from('message_log')
            .select('report_card_id, phone, status')
            .in('report_card_id', cardIds)
            .eq('status', 'sent')
        : { data: [] }
      const sentKeys = new Set((sentLogs ?? []).map((log) => {
        const row = log as { report_card_id: string | null; phone: string | null }
        return `${row.report_card_id}:${row.phone?.replace(/-/g, '')}`
      }))

      const studentById = new Map(((students ?? []) as unknown as StudentPhone[]).map((student) => [student.id, student]))
      for (const pair of pairs) {
        const pairKey = `${pair.student_id}:${pair.class_id}`
        const student = studentById.get(pair.student_id)
        const cls = classById.get(pair.class_id)
        const card = cardByKey.get(pairKey)
        if (!student || !cls || !card) {
          skipped.push({ id: pairKey, reason: '학생 또는 성적표 없음' })
          continue
        }
        const reportUrl = `${origin}/report-cards/${card.share_token}`
        const message = renderMonthlyMessage(template!, { studentName: student.name, periodLabel: period.label, className: cls.name, reportUrl })
        const sentPhones = new Set<string>()
        for (const recipient of recipients) {
          const phone = phoneFor(student, recipient)?.replace(/-/g, '').trim()
          if (!phone || sentPhones.has(phone)) continue
          sentPhones.add(phone)
          if (!body.include_resend && sentKeys.has(`${card.id}:${phone}`)) {
            skipped.push({ id: pairKey, student_name: student.name, reason: `${RECIPIENT_LABEL[recipient]} 이미 전송됨` })
            continue
          }
          targets.push({
            studentId: student.id,
            studentName: student.name,
            recipientLabel: RECIPIENT_LABEL[recipient],
            phone,
            message,
          })
          metas.push({
            kind,
            studentId: student.id,
            reportCardId: card.id,
            recipientLabel: RECIPIENT_LABEL[recipient],
            phone,
            message,
          })
        }
        if (sentPhones.size === 0) skipped.push({ id: pairKey, student_name: student.name, reason: '선택한 수신자 연락처 없음' })
      }
    } else if (kind === 'mock') {
      const mockExamId = body.mock_exam_id
      const resultIds = [...new Set(body.result_ids ?? [])].filter(Boolean)
      if (!mockExamId) return err('mock_exam_id가 필요합니다')
      if (resultIds.length === 0) return err('전송할 학생을 선택해 주세요')
      if (!(await assertMockExamOwner(supabase, mockExamId, teacherId))) return err('접근 권한이 없습니다', 403)

      const [{ data: exam }, { data: results, error: resultError }] = await Promise.all([
        supabase.from('mock_exam').select('title').eq('id', mockExamId).single(),
        supabase
          .from('mock_exam_result')
          .select('id, student_id, student(id, name, phone, mother_phone, father_phone, school, grade), mock_exam_report(id, share_token, status)')
          .eq('mock_exam_id', mockExamId)
          .in('id', resultIds),
      ])
      if (!exam) return err('모의고사를 찾을 수 없습니다', 404)
      if (resultError) return err(resultError.message, 500)

      const reportsByResultId = new Map<string, MockReportRow>()
      for (const result of (results ?? []) as unknown as MockResultRow[]) {
        const existing = reportList(result.mock_exam_report).find((report) => report.status === 'published')
        reportsByResultId.set(result.id, existing ?? await publishMockExamReport(supabase, mockExamId, result.id))
      }

      if (action === 'publish') {
        return ok({
          published_count: reportsByResultId.size,
          created_count: [...reportsByResultId.keys()].filter((resultId) => {
            const result = ((results ?? []) as unknown as MockResultRow[]).find((item) => item.id === resultId)
            return !reportList(result?.mock_exam_report).some((report) => report.status === 'published')
          }).length,
        })
      }

      const reportIds = [...reportsByResultId.values()].map((report) => report.id)
      const { data: sentLogs } = reportIds.length > 0
        ? await supabase
            .from('message_log')
            .select('mock_exam_report_id, phone, status')
            .in('mock_exam_report_id', reportIds)
            .eq('status', 'sent')
        : { data: [] }
      const sentKeys = new Set((sentLogs ?? []).map((log) => {
        const row = log as { mock_exam_report_id: string | null; phone: string | null }
        return `${row.mock_exam_report_id}:${row.phone?.replace(/-/g, '')}`
      }))

      for (const result of (results ?? []) as unknown as MockResultRow[]) {
        const student = one(result.student)
        const report = reportsByResultId.get(result.id)
        if (!student || !report) {
          skipped.push({ id: result.id, reason: '학생 또는 성적표 없음' })
          continue
        }
        const reportUrl = `${origin}/mock-exam-reports/${report.share_token}`
        const message = renderMockMessage(template!, { studentName: student.name, examTitle: (exam as { title: string }).title, reportUrl })
        const sentPhones = new Set<string>()
        for (const recipient of recipients) {
          const phone = phoneFor(student, recipient)?.replace(/-/g, '').trim()
          if (!phone || sentPhones.has(phone)) continue
          sentPhones.add(phone)
          if (!body.include_resend && sentKeys.has(`${report.id}:${phone}`)) {
            skipped.push({ id: result.id, student_name: student.name, reason: `${RECIPIENT_LABEL[recipient]} 이미 전송됨` })
            continue
          }
          targets.push({
            studentId: student.id,
            studentName: student.name,
            recipientLabel: RECIPIENT_LABEL[recipient],
            phone,
            message,
          })
          metas.push({
            kind,
            studentId: student.id,
            mockExamId,
            mockExamReportId: report.id,
            recipientLabel: RECIPIENT_LABEL[recipient],
            phone,
            message,
          })
        }
        if (sentPhones.size === 0) skipped.push({ id: result.id, student_name: student.name, reason: '선택한 수신자 연락처 없음' })
      }
    } else {
      return err('kind가 올바르지 않습니다')
    }

    if (targets.length === 0) {
      return ok({ sent_count: 0, failed_count: 0, results: [], skipped })
    }

    const sendResults = await sendMessages(targets)
    const logs = sendResults.map((result, index) => {
      const meta = metas[index]
      return {
        student_id: meta.studentId,
        week_id: null,
        message: meta.message,
        message_type: meta.kind === 'monthly' ? 'report_card' : 'mock_exam_report',
        report_card_id: meta.reportCardId ?? null,
        mock_exam_id: meta.mockExamId ?? null,
        mock_exam_report_id: meta.mockExamReportId ?? null,
        recipient_label: meta.recipientLabel,
        phone: meta.phone,
        status: result.success ? 'sent' : 'failed',
        error_message: result.success ? null : result.error ?? '발송 실패',
      }
    })

    if (logs.length > 0) {
      const { error: logError } = await supabase.from('message_log').insert(logs)
      if (logError) console.error('[report-dispatch] message_log insert failed:', logError)
    }

    return ok({
      sent_count: sendResults.filter((result) => result.success).length,
      failed_count: sendResults.filter((result) => !result.success).length,
      results: sendResults,
      skipped,
    })
  } catch (error) {
    return err(error instanceof Error ? error.message : '성적표 전송 실패', 500)
  }
}
