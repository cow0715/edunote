import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function getTeacherId(supabase: Awaited<ReturnType<typeof createClient>>, authId: string) {
  const { data } = await supabase.from('teacher').select('id').eq('auth_id', authId).single()
  return data?.id ?? null
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; memoId: string }> }) {
  const supabase = await createClient()
  const { memoId } = await params
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return NextResponse.json({ error: '강사 정보 없음' }, { status: 404 })

  const { error } = await supabase
    .from('teacher_memos')
    .delete()
    .eq('id', memoId)
    .eq('teacher_id', teacherId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
