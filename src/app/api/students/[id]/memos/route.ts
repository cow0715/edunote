import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: studentId } = await params
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { data, error } = await supabase
    .from('teacher_memos')
    .select('*')
    .eq('student_id', studentId)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })

  if (error) return err(error.message, 500)
  return ok(data ?? [])
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: studentId } = await params
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { content } = await request.json()
  if (!content?.trim()) return err('내용 필요')

  const { data, error } = await supabase
    .from('teacher_memos')
    .insert({ student_id: studentId, teacher_id: teacherId, content: content.trim() })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return ok(data, { status: 201 })
}
