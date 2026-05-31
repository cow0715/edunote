import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { sendMessages, type SendTarget } from '@/lib/solapi'
import { assertMockExamOwner } from '@/lib/mock-exam-server'

type RecipientKey = 'mother' | 'father' | 'student'

type SendReportsBody = {
  result_ids?: string[]
  recipients?: RecipientKey[]
  message_template?: string
}

type StudentPhone = {
  id: string
  name: string
  phone: string | null
  mother_phone: string | null
  father_phone: string | null
}

type ReportRelation = {
  id: string
  share_token: string
  status: 'published' | 'revoked'
} | {
  id: string
  share_token: string
  status: 'published' | 'revoked'
}[] | null

type ResultRow = {
  id: string
  student_id: string
  student?: StudentPhone | StudentPhone[] | null
  mock_exam_report?: ReportRelation
}

type ExamRow = {
  title: string
  exam_year: number
  exam_month: number
  grade: number | null
}

type SendTargetMeta = {
  mockExamId: string
  mockExamReportId: string
  studentId: string
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

function reportList(value: ReportRelation | undefined) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function renderMessage(template: string, args: { studentName: string; examTitle: string; reportUrl: string }) {
  return template
    .replaceAll('{학생명}', args.studentName)
    .replaceAll('{시험명}', args.examTitle)
    .replaceAll('{성적표링크}', args.reportUrl)
}

function phoneFor(student: StudentPhone, recipient: RecipientKey) {
  if (recipient === 'mother') return student.mother_phone
  if (recipient === 'father') return student.father_phone
  return student.phone
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증이 필요합니다', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  if (!(await assertMockExamOwner(supabase, id, teacherId))) return err('접근 권한이 없습니다', 403)

  const body = await request.json().catch(() => ({})) as SendReportsBody
  const resultIds = [...new Set((body.result_ids ?? []).filter(Boolean))]
  const recipients = [...new Set(body.recipients ?? ['mother', 'student'])].filter((key): key is RecipientKey => (
    key === 'mother' || key === 'father' || key === 'student'
  ))
  const template = body.message_template?.trim()

  if (resultIds.length === 0) return err('전송할 성적표를 선택해 주세요')
  if (recipients.length === 0) return err('수신자를 선택해 주세요')
  if (!template) return err('문자 내용을 입력해 주세요')
  if (!template.includes('{성적표링크}')) return err('문자 내용에 {성적표링크}를 포함해 주세요')

  const [{ data: exam }, { data: results, error: resultError }] = await Promise.all([
    supabase.from('mock_exam').select('title, exam_year, exam_month, grade').eq('id', id).single(),
    supabase
      .from('mock_exam_result')
      .select('id, student_id, student(id, name, phone, mother_phone, father_phone), mock_exam_report(id, share_token, status)')
      .eq('mock_exam_id', id)
      .in('id', resultIds),
  ])

  if (!exam) return err('모의고사를 찾을 수 없습니다', 404)
  if (resultError) return err(resultError.message, 500)

  const origin = new URL(request.url).origin
  const examTitle = (exam as ExamRow).title
  const targets: SendTarget[] = []
  const targetMetas: SendTargetMeta[] = []
  const skipped: { result_id: string; student_name?: string; reason: string }[] = []

  for (const result of (results ?? []) as unknown as ResultRow[]) {
    const student = one(result.student)
    const report = reportList(result.mock_exam_report).find((item) => item.status === 'published')
    if (!student) {
      skipped.push({ result_id: result.id, reason: '학생 정보 없음' })
      continue
    }
    if (!report) {
      skipped.push({ result_id: result.id, student_name: student.name, reason: '발행된 성적표 없음' })
      continue
    }

    const reportUrl = `${origin}/mock-exam-reports/${report.share_token}`
    const message = renderMessage(template, { studentName: student.name, examTitle, reportUrl })
    const sentPhones = new Set<string>()

    for (const recipient of recipients) {
      const phone = phoneFor(student, recipient)
      const normalizedPhone = phone?.replace(/-/g, '').trim()
      if (!normalizedPhone || sentPhones.has(normalizedPhone)) continue
      sentPhones.add(normalizedPhone)
      targets.push({
        studentId: student.id,
        studentName: student.name,
        recipientLabel: RECIPIENT_LABEL[recipient],
        phone: normalizedPhone,
        message,
      })
      targetMetas.push({
        mockExamId: id,
        mockExamReportId: report.id,
        studentId: student.id,
        recipientLabel: RECIPIENT_LABEL[recipient],
        phone: normalizedPhone,
        message,
      })
    }

    if (sentPhones.size === 0) {
      skipped.push({ result_id: result.id, student_name: student.name, reason: '선택한 수신자 연락처 없음' })
    }
  }

  if (targets.length === 0) {
    return ok({ results: [], sent_count: 0, failed_count: 0, skipped })
  }

  const sendResults = await sendMessages(targets)
  const logs = sendResults.map((result, index) => {
    const meta = targetMetas[index]
    return {
      student_id: meta.studentId,
      week_id: null,
      message: meta.message,
      message_type: 'mock_exam_report',
      mock_exam_id: meta.mockExamId,
      mock_exam_report_id: meta.mockExamReportId,
      recipient_label: meta.recipientLabel,
      phone: meta.phone,
      status: result.success ? 'sent' : 'failed',
      error_message: result.success ? null : result.error ?? '발송 실패',
    }
  })

  if (logs.length > 0) {
    const { error: logError } = await supabase.from('message_log').insert(logs)
    if (logError) console.error('[mock-exam report sms] message_log insert failed:', logError)
  }

  return ok({
    results: sendResults,
    sent_count: sendResults.filter((result) => result.success).length,
    failed_count: sendResults.filter((result) => !result.success).length,
    skipped,
  })
}
