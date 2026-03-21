import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function getTeacherId(supabase: Awaited<ReturnType<typeof createClient>>, authId: string) {
  const { data } = await supabase.from('teacher').select('id').eq('auth_id', authId).single()
  return data?.id ?? null
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: studentId } = await params
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { data, error } = await supabase
    .from('teacher_memos')
    .select('*')
    .eq('student_id', studentId)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: studentId } = await params
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { content } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: '내용 필요' }, { status: 400 })

  const { data, error } = await supabase
    .from('teacher_memos')
    .insert({ student_id: studentId, teacher_id: teacherId, content: content.trim() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
