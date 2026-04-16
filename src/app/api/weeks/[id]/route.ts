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

  const body = await request.json()
  const updates: Record<string, unknown> = {}
  if (body.start_date !== undefined) updates.start_date = body.start_date
  if (body.vocab_total !== undefined) updates.vocab_total = body.vocab_total
  if (body.reading_total !== undefined) updates.reading_total = body.reading_total
  if (body.homework_total !== undefined) updates.homework_total = body.homework_total

  const { data, error } = await supabase
    .from('week')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[PUT /api/weeks/[id]]', error)
    return err(error.message, 500)
  }

  return ok(data)
}
