import { err, getAuth, getTeacherId, ok } from '@/lib/api'
import { sendMessages, type SendTarget } from '@/lib/solapi'

type SendReportCardBody = {
  phone?: string
  recipient_label?: string
  message_template?: string
}

type ReportCardRow = {
  id: string
  teacher_id: string
  student_id: string
  period_label: string
  status: 'draft' | 'published'
  share_token: string
}

type StudentRow = {
  id: string
  name: string
}

function renderMessage(template: string, args: { studentName: string; periodLabel: string; reportUrl: string }) {
  return template
    .replaceAll('{학생명}', args.studentName)
    .replaceAll('{기간명}', args.periodLabel)
    .replaceAll('{성적표링크}', args.reportUrl)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증이 필요합니다', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보를 찾을 수 없습니다', 404)

  const { id } = await params
  const body = await request.json().catch(() => ({})) as SendReportCardBody
  const phone = body.phone?.replace(/-/g, '').trim()
  if (!phone) return err('전송할 전화번호를 입력해 주세요')

  const { data: card, error: cardError } = await supabase
    .from('report_card')
    .select('id, teacher_id, student_id, period_label, status, share_token')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (cardError || !card) return err('성적표를 찾을 수 없습니다', 404)

  const reportCard = card as ReportCardRow
  const { data: student } = await supabase
    .from('student')
    .select('id, name')
    .eq('id', reportCard.student_id)
    .single()

  if (!student) return err('학생 정보를 찾을 수 없습니다', 404)

  if (reportCard.status !== 'published') {
    const { error: publishError } = await supabase
      .from('report_card')
      .update({ status: 'published', published_at: new Date().toISOString(), revoked_at: null })
      .eq('id', reportCard.id)
      .eq('teacher_id', teacherId)
    if (publishError) return err(publishError.message, 500)
  }

  const studentRow = student as StudentRow
  const origin = new URL(request.url).origin
  const reportUrl = `${origin}/report-cards/${reportCard.share_token}`
  const template = body.message_template?.trim() || '{학생명} 학생 {기간명} 성적표입니다.\n{성적표링크}'
  if (!template.includes('{성적표링크}')) return err('문자 내용에 {성적표링크}를 포함해 주세요')
  const message = renderMessage(template, {
    studentName: studentRow.name,
    periodLabel: reportCard.period_label,
    reportUrl,
  })

  const target: SendTarget = {
    studentId: studentRow.id,
    studentName: studentRow.name,
    recipientLabel: body.recipient_label?.trim() || '테스트',
    phone,
    message,
  }
  const [result] = await sendMessages([target])

  const { error: logError } = await supabase.from('message_log').insert({
    student_id: studentRow.id,
    week_id: null,
    message,
    message_type: 'report_card',
    report_card_id: reportCard.id,
    recipient_label: target.recipientLabel,
    phone,
    status: result.success ? 'sent' : 'failed',
    error_message: result.success ? null : result.error ?? '발송 실패',
  })
  if (logError) console.error('[report-card sms] message_log insert failed:', logError)

  return ok({
    ...result,
    report_url: reportUrl,
  })
}
