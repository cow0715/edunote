import { getAuth, err, ok } from '@/lib/api'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { id } = await params
  const { name, concept_category_id, sort_order } = await request.json()

  const { data, error } = await supabase
    .from('concept_tag')
    .update({ name, concept_category_id: concept_category_id || null, sort_order })
    .eq('id', id)
    .select('*, concept_category(*)')
    .single()

  if (error) return err(error.message, 500)
  return ok(data)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const { id } = await params
  const { error } = await supabase.from('concept_tag').delete().eq('id', id)

  if (error) return err(error.message, 500)
  return ok({ ok: true })
}
