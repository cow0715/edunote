import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function getTeacherId(supabase: Awaited<ReturnType<typeof createClient>>, authId: string) {
  const { data, error } = await supabase.from('teacher').select('id').eq('auth_id', authId).single()
  if (error) console.error('[getTeacherId]', error)
  return data?.id ?? null
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { data, error } = await supabase
    .from('student')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('name')

  if (error) {
    console.error('[GET /api/students]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { name, phone, father_phone, mother_phone, school, grade, memo } = await request.json()

  const { data, error } = await supabase
    .from('student')
    .insert({ teacher_id: teacherId, name, phone, father_phone, mother_phone, school, grade, memo })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/students]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
