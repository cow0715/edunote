import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data: teacher, error: teacherError } = await supabase
    .from('teacher')
    .select('id')
    .eq('auth_id', user.id)
    .single()

  if (teacherError) console.error('[GET /api/classes] teacher 조회 실패:', teacherError)
  if (!teacher) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { data, error } = await supabase
    .from('class')
    .select('*')
    .eq('teacher_id', teacher.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/classes] class 조회 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data: teacher, error: teacherError } = await supabase
    .from('teacher')
    .select('id')
    .eq('auth_id', user.id)
    .single()

  if (teacherError) console.error('[POST /api/classes] teacher 조회 실패:', teacherError)
  if (!teacher) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const body = await request.json()
  const { name, description, start_date, end_date } = body

  const { data, error } = await supabase
    .from('class')
    .insert({ teacher_id: teacher.id, name, description, start_date, end_date })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/classes] class 생성 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
