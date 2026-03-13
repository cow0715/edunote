import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data, error } = await supabase
    .from('exam_question')
    .select('*, concept_tag(*, concept_category(*)), exam_question_choice(*)')
    .eq('week_id', weekId)
    .order('question_number')

  if (error) {
    console.error('[GET /api/weeks/[id]/questions]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const updates: { id: string; concept_tag_id: string | null }[] = await request.json()

  for (const { id, concept_tag_id } of updates) {
    const { error } = await supabase
      .from('exam_question')
      .update({ concept_tag_id })
      .eq('id', id)
      .eq('week_id', weekId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
