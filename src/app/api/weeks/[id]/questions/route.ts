import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data, error } = await supabase
    .from('exam_question')
    .select('*, exam_question_tag(concept_tag(*, concept_category(*))), exam_question_choice(*)')
    .eq('week_id', weekId)
    .order('question_number')
    .order('sub_label', { nullsFirst: true })

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

  const updates: { id: string; concept_tag_ids: string[]; question_style?: string }[] = await request.json()

  const VALID_STYLES = ['objective', 'subjective', 'grammar', 'multi_select']

  for (const { id, concept_tag_ids, question_style } of updates) {
    // 소유 확인
    const { data: q } = await supabase
      .from('exam_question')
      .select('id')
      .eq('id', id)
      .eq('week_id', weekId)
      .single()
    if (!q) continue

    // question_style 변경 요청이 있으면 업데이트
    if (question_style && VALID_STYLES.includes(question_style)) {
      await supabase.from('exam_question').update({ question_style }).eq('id', id)
    }

    // 기존 태그 전부 삭제 후 새로 삽입
    await supabase.from('exam_question_tag').delete().eq('exam_question_id', id)

    if (concept_tag_ids.length > 0) {
      const { error } = await supabase.from('exam_question_tag').insert(
        concept_tag_ids.map((tag_id) => ({ exam_question_id: id, concept_tag_id: tag_id }))
      )
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
