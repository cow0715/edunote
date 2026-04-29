import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params
  const { data: collection, error: collectionError } = await supabase
    .from('vocab_collection')
    .select('id, title, grade, year_from, year_to, months, item_count, created_at')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()

  if (collectionError || !collection) return err('단어장을 찾을 수 없습니다', 404)

  const { data: items, error: itemError } = await supabase
    .from('vocab_collection_item')
    .select('id, word, meaning, frequency, topic, synonyms, antonyms, similar_words, sources, sort_order')
    .eq('collection_id', id)
    .order('sort_order', { ascending: true })

  if (itemError) return err(itemError.message, 500)
  return ok({ ...collection, items: items ?? [] })
}
