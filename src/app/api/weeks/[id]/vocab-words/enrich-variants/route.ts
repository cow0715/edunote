import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { generateVariantMeanings, type VocabVariantMeaningCandidate } from '@/lib/vocab-variants'

export const maxDuration = 60

type WordRow = {
  id: string
  english_word: string
  correct_answer: string | null
}

type VariantRow = {
  id: string
  vocab_word_id: string
  word: string
  part_of_speech: string | null
  meaning: string | null
  relation_type: 'original' | 'synonym' | 'derivative' | 'antonym'
  usage_note: string | null
  raw_text: string | null
}

type CacheRow = {
  word_key: string
  word: string
  part_of_speech: string | null
  relation_type: 'original' | 'synonym' | 'derivative' | 'antonym'
  meaning: string
  usage_note: string | null
  excluded_meanings: string[] | null
  confidence: number | null
}

function wordKey(value: string) {
  return value.trim().toLowerCase()
}

function cacheKey(value: { word: string; part_of_speech: string | null }) {
  return `${wordKey(value.word)}::${value.part_of_speech ?? ''}`
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)
  const body = await request.json().catch(() => ({})) as { limit?: number; cacheOnly?: boolean }
  const cacheOnly = body.cacheOnly === true
  const limit = Math.max(1, Math.min(body.limit ?? (cacheOnly ? 1000 : 30), cacheOnly ? 1000 : 30))

  const { data: words, error: wordError } = await supabase
    .from('vocab_word')
    .select('id, english_word, correct_answer')
    .eq('week_id', weekId)

  if (wordError) return err(wordError.message, 500)
  const wordRows = (words ?? []) as WordRow[]
  const wordIds = wordRows.map((word) => word.id)
  if (wordIds.length === 0) return ok({ ok: true, processed: 0, updated: 0, remaining: 0 })

  const wordById = new Map(wordRows.map((word) => [word.id, word]))

  const { data: variants, error: variantError } = await supabase
    .from('vocab_word_variant')
    .select('id, vocab_word_id, word, part_of_speech, meaning, relation_type, usage_note, raw_text')
    .in('vocab_word_id', wordIds)
    .or('meaning.is.null,meaning.eq.,needs_review.eq.true')
    .order('sort_order')
    .limit(limit)

  if (variantError) return err(variantError.message, 500)
  const variantRows = (variants ?? []) as VariantRow[]
  if (variantRows.length === 0) return ok({ ok: true, processed: 0, updated: 0, remaining: 0 })

  const wordKeys = [...new Set(variantRows.map((variant) => wordKey(variant.word)).filter(Boolean))]
  const { data: cacheRows, error: cacheError } = wordKeys.length > 0
    ? await supabase
        .from('vocab_variant_cache')
        .select('word_key, word, part_of_speech, relation_type, meaning, usage_note, excluded_meanings, confidence')
        .in('word_key', wordKeys)
    : { data: [], error: null }

  if (cacheError) return err(cacheError.message, 500)

  const cacheByKey = new Map((cacheRows ?? []).map((row) => [cacheKey(row as CacheRow), row as CacheRow]))
  const cachedUpdates = variantRows.flatMap((variant) => {
    const cached = cacheByKey.get(cacheKey(variant))
    if (!cached) return []
    return [{
      id: variant.id,
      part_of_speech: cached.part_of_speech,
      meaning: cached.meaning,
      usage_note: cached.usage_note,
      excluded_meanings: cached.excluded_meanings ?? [],
      needs_review: false,
      confidence: cached.confidence,
    }]
  })

  let updated = 0
  for (const cached of cachedUpdates) {
    const { error: updateError } = await supabase
      .from('vocab_word_variant')
      .update({
        part_of_speech: cached.part_of_speech,
        meaning: cached.meaning,
        usage_note: cached.usage_note,
        excluded_meanings: cached.excluded_meanings,
        needs_review: cached.needs_review,
        confidence: cached.confidence,
      })
      .eq('id', cached.id)

    if (updateError) return err(updateError.message, 500)
    updated += 1
  }

  const uncachedRows = variantRows.filter((variant) => !cacheByKey.has(cacheKey(variant)))
  if (cacheOnly || uncachedRows.length === 0) {
    const { count } = await supabase
      .from('vocab_word_variant')
      .select('id', { count: 'exact', head: true })
      .in('vocab_word_id', wordIds)
      .or('meaning.is.null,meaning.eq.,needs_review.eq.true')

    return ok({
      ok: true,
      processed: variantRows.length,
      updated,
      remaining: count ?? 0,
    })
  }

  if (!process.env.ANTHROPIC_API_KEY) return err('단어 뜻 저장 설정이 없습니다.', 500)

  const candidates: VocabVariantMeaningCandidate[] = uncachedRows.flatMap((variant) => {
    const source = wordById.get(variant.vocab_word_id)
    if (!source) return []
    return [{
      id: variant.id,
      source_word: source.english_word,
      source_meaning: source.correct_answer,
      word: variant.word,
      part_of_speech: variant.part_of_speech,
      relation_type: variant.relation_type,
      usage_note: variant.usage_note,
      raw_text: variant.raw_text,
    }]
  })

  const generated = await generateVariantMeanings(candidates)
  for (const result of generated) {
    const { error: updateError } = await supabase
      .from('vocab_word_variant')
      .update({
        part_of_speech: result.part_of_speech,
        meaning: result.meaning,
        usage_note: result.usage_note,
        excluded_meanings: result.excluded_meanings,
        needs_review: result.needs_review,
        confidence: result.confidence,
      })
      .eq('id', result.id)

    if (updateError) return err(updateError.message, 500)
    if (result.meaning) updated += 1
  }

  const cacheInsertCandidates = generated
    .filter((result) => result.meaning)
    .map((result) => {
      const source = uncachedRows.find((variant) => variant.id === result.id)
      return {
        word_key: wordKey(result.word || source?.word || ''),
        word: result.word || source?.word || '',
        part_of_speech: result.part_of_speech,
        relation_type: source?.relation_type ?? 'derivative',
        meaning: result.meaning!,
        usage_note: result.usage_note,
        excluded_meanings: result.excluded_meanings,
        confidence: result.confidence,
      }
    })
    .filter((row) => row.word_key && row.word && row.meaning)
  const cacheInserts = [...new Map(cacheInsertCandidates.map((row) => [cacheKey(row), row])).values()]

  if (cacheInserts.length > 0) {
    const { error: upsertCacheError } = await supabase
      .from('vocab_variant_cache')
      .upsert(cacheInserts, { onConflict: 'word_key,part_of_speech_key' })
    if (upsertCacheError) return err(upsertCacheError.message, 500)
  }

  const { count } = await supabase
    .from('vocab_word_variant')
    .select('id', { count: 'exact', head: true })
    .in('vocab_word_id', wordIds)
    .or('meaning.is.null,meaning.eq.,needs_review.eq.true')

  return ok({
    ok: true,
    processed: cachedUpdates.length + candidates.length,
    updated,
    remaining: count ?? 0,
  })
}
