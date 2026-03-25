import { getAuth, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id } = await params
  if (!user) return err('인증 필요', 401)

  const { data, error } = await supabase
    .from('week')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[GET /api/weeks/[id]]', error)
    return err(error.message, 500)
  }

  return ok(data)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id } = await params
  if (!user) return err('인증 필요', 401)

  const { start_date, vocab_total, reading_total, homework_total } = await request.json()

  const { data, error } = await supabase
    .from('week')
    .update({ start_date, vocab_total, reading_total, homework_total })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[PUT /api/weeks/[id]]', error)
    return err(error.message, 500)
  }

  return ok(data)
}
