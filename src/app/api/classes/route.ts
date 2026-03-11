import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateSessionDates } from '@/lib/schedule'

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
  const { name, description, start_date, end_date, schedule_days = [] } = body

  const { data, error } = await supabase
    .from('class')
    .insert({ teacher_id: teacher.id, name, description, start_date, end_date, schedule_days })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/classes] class 생성 실패:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 요일 설정이 있으면 주차 자동 생성
  if (schedule_days.length > 0 && start_date && end_date) {
    const dates = generateSessionDates(start_date, end_date, schedule_days)
    if (dates.length > 0) {
      const weekRows = dates.map((date, i) => ({
        class_id: data.id,
        week_number: i + 1,
        start_date: date,
        vocab_total: 0,
        homework_total: 0,
      }))
      await supabase.from('week').insert(weekRows)
    }
  }

  return NextResponse.json(data, { status: 201 })
}
