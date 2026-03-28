import { getAuth, err, ok } from '@/lib/api'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: studentId } = await params
  const { left_at } = await request.json()
  if (!left_at) return err('퇴원일 필요', 400)

  const { error } = await supabase
    .from('class_student')
    .update({ left_at })
    .eq('student_id', studentId)
    .is('left_at', null)

  if (error) { console.error('[POST /api/students/[id]/withdraw]', error); return err(error.message, 500) }
  return ok({ ok: true })
}
