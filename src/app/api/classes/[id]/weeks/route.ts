import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: classId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data, error } = await supabase
    .from('week')
    .select('*')
    .eq('class_id', classId)
    .order('week_number')

  if (error) {
    console.error('[GET /api/classes/[id]/weeks]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: classId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const { data: existing } = await supabase
    .from('week')
    .select('week_number')
    .eq('class_id', classId)
    .order('week_number', { ascending: false })
    .limit(1)

  const nextWeekNumber = existing && existing.length > 0 ? existing[0].week_number + 1 : 1

  const { data, error } = await supabase
    .from('week')
    .insert({ class_id: classId, week_number: nextWeekNumber, vocab_total: 0, homework_total: 0 })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/classes/[id]/weeks]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
