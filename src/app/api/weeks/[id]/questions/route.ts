import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data, error } = await supabase
    .from('exam_question')
    .select('*, question_type(*)')
    .eq('week_id', weekId)
    .order('question_number')

  if (error) {
    console.error('[GET /api/weeks/[id]/questions]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// 문항 전체 교체 (기존 삭제 후 새로 삽입)
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const questions: { question_number: number; correct_answer: number; question_type_id: string | null; exam_type: 'vocab' | 'reading' }[] = await request.json()

  // 기존 문항 삭제
  const { error: deleteError } = await supabase
    .from('exam_question')
    .delete()
    .eq('week_id', weekId)

  if (deleteError) {
    console.error('[PUT /api/weeks/[id]/questions] delete', deleteError)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  if (questions.length === 0) return NextResponse.json([])

  const { data, error } = await supabase
    .from('exam_question')
    .insert(questions.map((q) => ({ ...q, week_id: weekId })))
    .select('*, question_type(*)')

  if (error) {
    console.error('[PUT /api/weeks/[id]/questions] insert', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
