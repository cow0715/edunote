import { getAuth, getTeacherId, err, ok } from '@/lib/api'

type VocabCollectionItemRow = {
  id: string
  word: string
  meaning: string
  frequency: number
  topic: string
  synonyms: string[]
  antonyms: string[]
  similar_words: string[]
  sources: unknown
  sort_order: number
}

async function fetchCollectionItems(
  supabase: Awaited<ReturnType<typeof getAuth>>['supabase'],
  collectionId: string,
) {
  const rows: VocabCollectionItemRow[] = []
  let from = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('vocab_collection_item')
      .select('id, word, meaning, frequency, topic, synonyms, antonyms, similar_words, sources, sort_order')
      .eq('collection_id', collectionId)
      .order('sort_order', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as VocabCollectionItemRow[]))
    if (!data || data.length < pageSize) break
    from += pageSize
  }

  return rows
}

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

  try {
    const items = await fetchCollectionItems(supabase, id)
    return ok({ ...collection, items })
  } catch (error) {
    return err(error instanceof Error ? error.message : '단어장 항목 조회 실패', 500)
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const { id } = await params
  const { data, error } = await supabase
    .from('vocab_collection')
    .delete()
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .select('id')
    .single()

  if (error || !data) return err('단어장을 찾을 수 없습니다', 404)
  return ok({ ok: true, id })
}
