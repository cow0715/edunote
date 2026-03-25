import { getAuth, err, ok } from '@/lib/api'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const url = new URL(request.url)
  const date = url.searchParams.get('date')
  let query = supabase.from('attendance').select('*').eq('class_id', classId).order('date', { ascending: false })
  if (date) query = query.eq('date', date)
  const { data, error } = await query
  if (error) return err(error.message, 500)
  return ok(data ?? [])
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const body: { date: string; records: { student_id: string; status: 'present' | 'late' | 'absent'; note?: string | null }[] } = await request.json()
  if (!body.date || !Array.isArray(body.records)) return err('잘못된 요청', 400)
  const rows = body.records.map((r) => ({ class_id: classId, student_id: r.student_id, date: body.date, status: r.status, note: r.note ?? null }))
  const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'class_id,student_id,date' })
  if (error) return err(error.message, 500)
  return ok({ ok: true })
}