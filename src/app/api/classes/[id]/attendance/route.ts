import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: classId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const url = new URL(request.url)
  const date = url.searchParams.get('date')

  let query = supabase
    .from('attendance')
    .select('*')
    .eq('class_id', classId)
    .order('date', { ascending: false })

  if (date) query = query.eq('date', date)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id: classId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const body: { date: string; records: { student_id: string; status: 'present' | 'late' | 'absent'; note?: string | null }[] } = await request.json()

  if (!body.date || !Array.isArray(body.records)) {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })
  }

  const rows = body.records.map((r) => ({
    class_id: classId,
    student_id: r.student_id,
    date: body.date,
    status: r.status,
    note: r.note ?? null,
  }))

  const { error } = await supabase
    .from('attendance')
    .upsert(rows, { onConflict: 'class_id,student_id,date' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
