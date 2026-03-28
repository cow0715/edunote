import { getAuth, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: studentId } = await params
  const { data, error } = await supabase
    .from('class_student')
    .select('class_id, joined_at, left_at, class(name)')
    .eq('student_id', studentId)
    .order('joined_at')
  if (error) { console.error('[GET /api/students/[id]/enrollments]', error); return err(error.message, 500) }
  return ok(data)
}
