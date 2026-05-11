import { generateVariantMeanings, type VocabVariantMeaningCandidate } from '@/lib/vocab-variants'

const DEFAULT_LIMIT = 50

type SupabaseClientLike = {
  from: (table: string) => any
}

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
  needs_review?: boolean | null
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

export type EnrichedVariantSummary = {
  id: string
  word: string
  part_of_speech: string | null
  meaning: string | null
  needs_review: boolean | null
}

function wordKey(value: string) {
  return value.trim().toLowerCase()
}

function cacheKey(value: { word: string; part_of_speech: string | null }) {
  return `${wordKey(value.word)}::${value.part_of_speech ?? ''}`
}

async function countRemaining(supabase: SupabaseClientLike, wordIds: string[]) {
  if (wordIds.length === 0) return 0
  const { count } = await supabase
    .from('vocab_word_variant')
    .select('id', { count: 'exact', head: true })
    .in('vocab_word_id', wordIds)
    .or('meaning.is.null,meaning.eq.,needs_review.eq.true')
  return count ?? 0
}

export async function enrichVocabVariantMeanings(
  supabase: SupabaseClientLike,
  options: {
    weekId: string
    variantIds?: string[]
    limit?: number
    cacheOnly?: boolean
  }
) {
  const requestedVariantIds = [...new Set((options.variantIds ?? []).filter(Boolean))]
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT))
  const cacheOnly = options.cacheOnly === true

  const { data: weekWords, error: wordError } = await supabase
    .from('vocab_word')
    .select('id, english_word, correct_answer')
    .eq('week_id', options.weekId)

  if (wordError) throw new Error(wordError.message)
  const wordRows = (weekWords ?? []) as WordRow[]
  const wordIds = wordRows.map((word) => word.id)
  if (wordIds.length === 0) {
    return { processed: 0, updated: 0, remaining: 0, variants: [] as EnrichedVariantSummary[] }
  }

  const wordById = new Map(wordRows.map((word) => [word.id, word]))

  let variantQuery = supabase
    .from('vocab_word_variant')
    .select('id, vocab_word_id, word, part_of_speech, meaning, relation_type, usage_note, raw_text, needs_review')

  if (requestedVariantIds.length > 0) {
    variantQuery = variantQuery.in('id', requestedVariantIds)
  } else {
    variantQuery = variantQuery
      .in('vocab_word_id', wordIds)
      .or('meaning.is.null,meaning.eq.,needs_review.eq.true')
      .order('sort_order')
      .limit(limit)
  }

  const { data: variants, error: variantError } = await variantQuery
  if (variantError) throw new Error(variantError.message)

  const allRequestedRows = ((variants ?? []) as VariantRow[])
    .filter((variant) => wordById.has(variant.vocab_word_id))
  const variantRows = allRequestedRows
    .filter((variant) => !variant.meaning || variant.needs_review === true)
    .slice(0, limit)

  if (variantRows.length === 0) {
    return {
      processed: 0,
      updated: 0,
      remaining: await countRemaining(supabase, wordIds),
      variants: allRequestedRows.map((variant) => ({
        id: variant.id,
        word: variant.word,
        part_of_speech: variant.part_of_speech,
        meaning: variant.meaning,
        needs_review: variant.needs_review ?? null,
      })),
    }
  }

  const wordKeys = [...new Set(variantRows.map((variant) => wordKey(variant.word)).filter(Boolean))]
  const { data: cacheRows, error: cacheError } = wordKeys.length > 0
    ? await supabase
        .from('vocab_variant_cache')
        .select('word_key, word, part_of_speech, relation_type, meaning, usage_note, excluded_meanings, confidence')
        .in('word_key', wordKeys)
    : { data: [], error: null }

  if (cacheError) console.error('[vocab-variant-enrichment] cache lookup failed', cacheError)

  const cacheByKey = new Map<string, CacheRow>((cacheError ? [] : ((cacheRows ?? []) as CacheRow[])).map((row) => [cacheKey(row), row]))
  let updated = 0
  const updatedVariantIds = new Set<string>()

  for (const variant of variantRows) {
    const cached = cacheByKey.get(cacheKey(variant))
    if (!cached) continue
    const { error: updateError } = await supabase
      .from('vocab_word_variant')
      .update({
        part_of_speech: cached.part_of_speech,
        meaning: cached.meaning,
        usage_note: cached.usage_note,
        excluded_meanings: cached.excluded_meanings ?? [],
        needs_review: false,
        confidence: cached.confidence,
      })
      .eq('id', variant.id)

    if (updateError) throw new Error(updateError.message)
    updated += 1
    updatedVariantIds.add(variant.id)
  }

  const uncachedRows = variantRows.filter((variant) => !updatedVariantIds.has(variant.id))
  if (!cacheOnly && uncachedRows.length > 0) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('단어 뜻 저장 설정이 없습니다.')

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

      if (updateError) throw new Error(updateError.message)
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
      if (upsertCacheError) {
        const { error: legacyUpsertCacheError } = await supabase
          .from('vocab_variant_cache')
          .upsert(cacheInserts, { onConflict: 'word_key,part_of_speech_key,relation_type' })
        if (legacyUpsertCacheError) {
          console.error('[vocab-variant-enrichment] cache upsert failed', legacyUpsertCacheError)
        }
      }
    }
  }

  const finalIds = requestedVariantIds.length > 0
    ? allRequestedRows.map((variant) => variant.id)
    : variantRows.map((variant) => variant.id)
  const { data: finalRows, error: finalError } = finalIds.length > 0
    ? await supabase
        .from('vocab_word_variant')
        .select('id, word, part_of_speech, meaning, needs_review')
        .in('id', finalIds)
    : { data: [], error: null }

  if (finalError) throw new Error(finalError.message)

  return {
    processed: variantRows.length,
    updated,
    remaining: await countRemaining(supabase, wordIds),
    variants: ((finalRows ?? []) as EnrichedVariantSummary[]),
  }
}
