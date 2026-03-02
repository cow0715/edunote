import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function getTeacherId(supabase: Awaited<ReturnType<typeof createClient>>, authId: string) {
  const { data } = await supabase.from('teacher').select('id').eq('auth_id', authId).single()
  return data?.id ?? null
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: classId } = await params
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data, error } = await supabase
    .from('class_student')
    .select('*, student(*)')
    .eq('class_id', classId)
    .order('created_at')

  if (error) {
    console.error('[GET /api/classes/[id]/students]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: classId } = await params
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { student_id } = await request.json()

  const { data, error } = await supabase
    .from('class_student')
    .insert({ class_id: classId, student_id })
    .select('*, student(*)')
    .single()

  if (error) {
    console.error('[POST /api/classes/[id]/students]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
