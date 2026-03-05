import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data, error } = await supabase
    .from('exam_question')
    .select('*, question_type(*), concept_tag(*, concept_category(*)), exam_question_choice(*)')
    .eq('week_id', weekId)
    .order('question_number')

  if (error) {
    console.error('[GET /api/weeks/[id]/questions]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// 문항 저장 (upsert로 기존 ID 유지 → student_answer FK 보호)
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: weekId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  type QuestionPayload = {
    question_number: number
    correct_answer: number
    question_type_id: string | null
    concept_tag_id: string | null
    exam_type: 'vocab' | 'reading'
    choices: { choice_number: number; concept_tag_id: string | null }[]
  }

  const questions: QuestionPayload[] = await request.json()

  // 줄어든 문항 삭제 (문항 수 감소 시)
  const examType = questions[0]?.exam_type ?? 'reading'
  const keepNumbers = questions.map((q) => q.question_number)

  if (keepNumbers.length > 0) {
    await supabase
      .from('exam_question')
      .delete()
      .eq('week_id', weekId)
      .eq('exam_type', examType)
      .not('question_number', 'in', `(${keepNumbers.join(',')})`)
  } else {
    await supabase.from('exam_question').delete().eq('week_id', weekId).eq('exam_type', examType)
    return NextResponse.json([])
  }

  // upsert: 기존 문항은 ID 유지하면서 정답/유형만 업데이트
  const { data, error } = await supabase
    .from('exam_question')
    .upsert(
      questions.map(({ choices: _choices, ...q }) => ({ ...q, week_id: weekId })),
      { onConflict: 'week_id,exam_type,question_number' }
    )
    .select('*, question_type(*), concept_tag(*, concept_category(*)), exam_question_choice(*)')

  if (error) {
    console.error('[PUT /api/weeks/[id]/questions] upsert', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 선택지 태그 저장
  const questionIdMap = new Map((data ?? []).map((q) => [q.question_number, q.id]))
  const questionIds = (data ?? []).map((q) => q.id)

  // 기존 선택지 삭제 후 재삽입 (문항별 태그 완전 교체)
  if (questionIds.length > 0) {
    await supabase.from('exam_question_choice').delete().in('exam_question_id', questionIds)
  }

  const allChoices = questions.flatMap((q) =>
    (q.choices ?? [])
      .filter((c) => c.concept_tag_id)
      .map((c) => ({
        exam_question_id: questionIdMap.get(q.question_number)!,
        choice_number: c.choice_number,
        concept_tag_id: c.concept_tag_id,
      }))
  )

  if (allChoices.length > 0) {
    const { error: choiceError } = await supabase.from('exam_question_choice').insert(allChoices)
    if (choiceError) {
      console.error('[PUT /api/weeks/[id]/questions] choices insert', choiceError)
      return NextResponse.json({ error: choiceError.message }, { status: 500 })
    }
  }

  return NextResponse.json(data)
}
