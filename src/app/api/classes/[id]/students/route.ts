import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const { data, error } = await supabase.from('class_student').select('*, student(*)').eq('class_id', classId).order('created_at')
  if (error) { console.error('[GET /api/classes/[id]/students]', error); return err(error.message, 500) }
  return ok(data)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  const { student_id } = await request.json()
  const { data, error } = await supabase.from('class_student').insert({ class_id: classId, student_id }).select('*, student(*)').single()
  if (error) { console.error('[POST /api/classes/[id]/students]', error); return err(error.message, 500) }
  return ok(data, { status: 201 })
}