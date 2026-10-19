import { collectPages } from '@/lib/collect-pages'
import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  try {
    const data = await collectPages((from, to) => supabase.from('student')
      .select('*, class_student(class_id, joined_at, left_at, class:class_id(name))')
      .eq('teacher_id', teacherId).order('name').order('id').range(from, to))
    return ok(data)
  } catch (error) {
    console.error('[GET /api/students]', error)
    return err('학생 목록 조회 실패', 500)
  }
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  const { name, phone, father_phone, mother_phone, school, grade, memo, class_id, joined_at } = await request.json()

  const { data, error } = await supabase
    .from('student')
    .insert({ teacher_id: teacherId, name, phone, father_phone, mother_phone, school, grade, memo })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/students]', error)
    return err(error.message, 500)
  }

  if (class_id) {
    await supabase.from('class_student').upsert(
      { class_id, student_id: data.id, left_at: null, ...(joined_at ? { joined_at } : {}) },
      { onConflict: 'class_id,student_id' }
    )
  }

  return ok(data, { status: 201 })
}
