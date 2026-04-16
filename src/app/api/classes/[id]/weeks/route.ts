import { getAuth, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const { data, error } = await supabase.from('week').select('*').eq('class_id', classId).order('week_number')
  if (error) { console.error('[GET /api/classes/[id]/weeks]', error); return err(error.message, 500) }
  return ok(data)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)
  const { id: classId } = await params
  const body = await request.json().catch(() => ({}))
  const { data: existing } = await supabase.from('week').select('week_number').eq('class_id', classId).order('week_number', { ascending: false }).limit(1)
  const nextWeekNumber = existing && existing.length > 0 ? existing[0].week_number + 1 : 1
  const insert: Record<string, unknown> = { class_id: classId, week_number: nextWeekNumber, vocab_total: 0, homework_total: 0 }
  if (body.start_date) insert.start_date = body.start_date
  const { data, error } = await supabase.from('week').insert(insert).select().single()
  if (error) { console.error('[POST /api/classes/[id]/weeks]', error); return err(error.message, 500) }
  return ok(data, { status: 201 })
}