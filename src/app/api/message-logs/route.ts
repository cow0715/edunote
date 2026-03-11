import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// 전송 내역 목록 조회
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const studentId = searchParams.get('student_id')

  let query = supabase
    .from('message_log')
    .select('*, student(id, name, mother_phone, father_phone, phone), week(id, week_number, class_id, class(id, name))')
    .order('sent_at', { ascending: false })

  if (studentId) query = query.eq('student_id', studentId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

// 전송 완료 저장
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { student_id, week_id, message } = await request.json()
  if (!student_id || !week_id || !message) {
    return NextResponse.json({ error: '필수 항목 누락' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('message_log')
    .insert({ student_id, week_id, message })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
