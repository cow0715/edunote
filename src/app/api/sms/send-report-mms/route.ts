import { getAuth, err, ok } from '@/lib/api'
import { sendMmsWithBase64Image } from '@/lib/solapi'

export const maxDuration = 60

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const body = await request.json() as {
    studentId: string
    phone: string
    recipientLabel: string
    image: string
    subject?: string
    text?: string
  }

  if (!body.studentId || !body.phone || !body.image) {
    return err('필수 파라미터 누락 (studentId, phone, image)')
  }

  const { data: student } = await supabase
    .from('student')
    .select('id, name')
    .eq('id', body.studentId)
    .single()

  if (!student) return err('학생 없음', 404)

  const result = await sendMmsWithBase64Image(
    {
      studentId: student.id,
      studentName: student.name,
      recipientLabel: body.recipientLabel ?? '학부모',
      phone: body.phone,
      subject: body.subject,
      text: body.text,
    },
    body.image,
  )

  return ok(result)
}
