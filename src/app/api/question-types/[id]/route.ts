import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function getTeacherId(supabase: Awaited<ReturnType<typeof createClient>>, authId: string) {
  const { data } = await supabase.from('teacher').select('id').eq('auth_id', authId).single()
  return data?.id ?? null
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id } = await params
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { name, sort_order } = await request.json()

  const { data, error } = await supabase
    .from('question_type')
    .update({ name, sort_order })
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .select()
    .single()

  if (error) {
    console.error('[PUT /api/question-types]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id } = await params
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { error } = await supabase
    .from('question_type')
    .delete()
    .eq('id', id)
    .eq('teacher_id', teacherId)

  if (error) {
    console.error('[DELETE /api/question-types]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
