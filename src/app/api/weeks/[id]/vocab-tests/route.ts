import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'
import { enrichVocabVariantMeanings } from '@/lib/vocab-variant-enrichment'

type VocabTestRow = {
  id: string
  week_id: string
  title: string
  is_active: boolean
  item_count: number
  created_at: string
}

type VocabTestItemRow = {
  id: string
  vocab_test_id: string
  vocab_word_id: string
  vocab_word_variant_id: string | null
  test_number: number
  sort_order: number
  prompt_source: string | null
  prompt_text: string | null
  vocab_word: {
    id: string
    number: number
    passage_label: string | null
    english_word: string
    part_of_speech: string | null
    correct_answer: string | null
    synonyms: string[] | null
    antonyms: string[] | null
    derivatives: string | null
  } | { id: string; number: number; passage_label: string | null; english_word: string; part_of_speech: string | null; correct_answer: string | null; synonyms: string[] | null; antonyms: string[] | null; derivatives: string | null }[] | null
  vocab_word_variant: {
    id: string
    word: string
    part_of_speech: string | null
    meaning: string | null
    relation_type: string
  } | { id: string; word: string; part_of_speech: string | null; meaning: string | null; relation_type: string }[] | null
}

type ActiveTestItemRow = {
  vocab_test_id: string
  vocab_word_id: string
  vocab_word_variant_id: string | null
  sort_order: number
  prompt_source: string | null
  prompt_text: string | null
}

type RequestedTestItem = {
  wordId: string
  variantId?: string
  promptSource?: string
  promptText?: string
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

function normalizePromptDuplicateKey(value: string | null | undefined) {
  return (value ?? '')
    .replace(/\((?:n|v|a|ad|adj|adv|prep|conj|phr|phrase)\.?\)/gi, ' ')
    .replace(/\b(?:n|v|a|ad|adj|adv|prep|conj|phr|phrase)\.\s*$/gi, ' ')
    .replace(/[’`]/g, "'")
    .replace(/[^A-Za-z0-9'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

async function requireOwner(weekId: string) {
  const { supabase, user } = await getAuth()
  if (!user) return { error: err('인증 필요', 401) }
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return { error: err('강사 정보 없음', 404) }
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return { error: err('접근 권한 없음', 403) }
  return { supabase: createServiceClient() }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: weekId } = await params
  const auth = await requireOwner(weekId)
  if ('error' in auth) return auth.error
  const { supabase } = auth
  const testId = new URL(request.url).searchParams.get('testId')

  let query = supabase
    .from('vocab_test')
    .select('id, week_id, title, is_active, item_count, created_at')
    .eq('week_id', weekId)
    .order('created_at', { ascending: false })

  if (testId) query = query.eq('id', testId)

  const { data: tests, error: testError } = await query
  if (testError) return err(testError.message, 500)

  const testRows = (tests ?? []) as VocabTestRow[]
  const testIds = testRows.map((test) => test.id)
  const { data: items, error: itemError } = testIds.length > 0
    ? await supabase
        .from('vocab_test_item')
        .select('id, vocab_test_id, vocab_word_id, vocab_word_variant_id, test_number, sort_order, prompt_source, prompt_text, vocab_word(id, number, passage_label, english_word, part_of_speech, correct_answer, synonyms, antonyms, derivatives), vocab_word_variant(id, word, part_of_speech, meaning, relation_type)')
        .in('vocab_test_id', testIds)
        .order('sort_order')
    : { data: [], error: null }

  if (itemError) return err(itemError.message, 500)

  const itemsByTestId = new Map<string, VocabTestItemRow[]>()
  for (const item of (items ?? []) as unknown as VocabTestItemRow[]) {
    const list = itemsByTestId.get(item.vocab_test_id) ?? []
    list.push({ ...item, vocab_word: one(item.vocab_word), vocab_word_variant: one(item.vocab_word_variant) })
    itemsByTestId.set(item.vocab_test_id, list)
  }

  const data = testRows.map((test) => ({
    ...test,
    items: (itemsByTestId.get(test.id) ?? []).sort((a, b) => a.sort_order - b.sort_order),
  }))

  return ok({ tests: data, activeTest: data.find((test) => test.is_active) ?? data[0] ?? null })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: weekId } = await params
  const auth = await requireOwner(weekId)
  if ('error' in auth) return auth.error
  const { supabase } = auth

  const body = await request.json().catch(() => ({})) as {
    title?: string
    wordIds?: string[]
    items?: RequestedTestItem[]
  }
  const requestedItems = (body.items?.length ? body.items.map((item) => item.wordId) : body.wordIds ?? [])
    .filter(Boolean)
    .map((wordId, index) => {
      const item = body.items?.find((candidate) => candidate.wordId === wordId)
      return {
        wordId,
        variantId: item?.variantId,
        promptSource: item?.promptSource === 'synonym' || item?.promptSource === 'derivative' ? item.promptSource : 'word',
        promptText: item?.promptText?.trim() || '',
        index,
      }
    })
  const seen = new Set<string>()
  const uniqueRequestedItems = requestedItems.filter((item) => {
    if (seen.has(item.wordId)) return false
    seen.add(item.wordId)
    return true
  })
  const wordIds = uniqueRequestedItems.map((item) => item.wordId)
  if (wordIds.length === 0) return err('시험 단어를 선택해주세요')

  const { data: words, error: wordError } = await supabase
    .from('vocab_word')
    .select('id')
    .eq('week_id', weekId)
    .in('id', wordIds)

  if (wordError) return err(wordError.message, 500)
  const allowedIds = new Set((words ?? []).map((word) => word.id))
  const validWordIds = wordIds.filter((id) => allowedIds.has(id))
  if (validWordIds.length === 0) return err('선택한 단어를 찾을 수 없습니다', 422)
  const { data: variants } = await supabase
    .from('vocab_word_variant')
    .select('id, vocab_word_id, word, relation_type, exam_enabled, sort_order')
    .in('vocab_word_id', validWordIds)

  type VariantRow = NonNullable<typeof variants>[number]
  const variantsByWordId = new Map<string, VariantRow[]>()
  for (const variant of variants ?? []) {
    const list = variantsByWordId.get(variant.vocab_word_id) ?? []
    list.push(variant)
    variantsByWordId.set(variant.vocab_word_id, list)
  }
  const validItems = uniqueRequestedItems
    .filter((item) => allowedIds.has(item.wordId))
    .map((item) => {
      const wordVariants = variantsByWordId.get(item.wordId) ?? []
      const selectedVariant = item.promptSource === 'word'
        ? wordVariants.find((variant) => variant.relation_type === 'original') ?? null
        : wordVariants.find((variant) => variant.id === item.variantId)
          ?? wordVariants.find((variant) =>
            variant.relation_type === item.promptSource && variant.word.toLowerCase() === item.promptText.toLowerCase()
          )
          ?? null
      return {
        ...item,
        variantId: selectedVariant?.id ?? null,
        promptText: item.promptText || selectedVariant?.word || '',
      }
    })
  const invalidVariantItems = validItems.filter((item) => item.promptSource !== 'word' && !item.variantId)
  if (invalidVariantItems.length > 0) {
    return err('선택한 유의어/파생어를 찾을 수 없습니다. 단어를 다시 랜덤 선택해주세요.', 422)
  }
  const seenPromptKeys = new Set<string>()
  const dedupedValidItems = validItems.filter((item) => {
    const key = normalizePromptDuplicateKey(item.promptText)
    if (!key) return true
    if (seenPromptKeys.has(key)) return false
    seenPromptKeys.add(key)
    return true
  })
  const selectedVariantIds = dedupedValidItems
    .map((item) => item.variantId)
    .filter((id): id is string => Boolean(id))
  if (selectedVariantIds.length > 0) {
    try {
      for (const batch of chunks(selectedVariantIds, 50)) {
        await enrichVocabVariantMeanings(supabase, {
          weekId,
          variantIds: batch,
          limit: 50,
        })
      }
    } catch (error) {
      console.error('[vocab-tests] variant meaning enrichment failed', error)
      return err(error instanceof Error ? error.message : '단어 뜻 저장 실패', 500)
    }
  }

  const { data: previousActiveTests } = await supabase
    .from('vocab_test')
    .select('id')
    .eq('week_id', weekId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  const previousActiveIds = (previousActiveTests ?? []).map((test) => test.id)
  const { data: previousItems } = previousActiveIds.length > 0
    ? await supabase
        .from('vocab_test_item')
        .select('vocab_test_id, vocab_word_id, vocab_word_variant_id, sort_order, prompt_source, prompt_text')
        .in('vocab_test_id', previousActiveIds)
    : { data: [] }

  const previousActiveItemIds = ((previousItems ?? []) as ActiveTestItemRow[])
    .filter((item) => item.vocab_test_id === previousActiveIds[0])
    .sort((a, b) => a.sort_order - b.sort_order)
  const sameSelection = previousActiveItemIds.length === dedupedValidItems.length &&
    previousActiveItemIds.every((item, index) => {
      const next = dedupedValidItems[index]
      return item.vocab_word_id === next.wordId &&
        (item.vocab_word_variant_id ?? null) === (next.variantId ?? null) &&
        (item.prompt_source ?? 'word') === next.promptSource &&
        (item.prompt_text ?? '') === next.promptText
    })

  const { error: deactivateError } = await supabase.from('vocab_test').update({ is_active: false }).eq('week_id', weekId)
  if (deactivateError) return err(deactivateError.message, 500)

  const { data: test, error: testError } = await supabase
    .from('vocab_test')
    .insert({
      week_id: weekId,
      title: body.title?.trim() || '단어시험',
      is_active: true,
      item_count: dedupedValidItems.length,
    })
    .select('id, week_id, title, is_active, item_count, created_at')
    .single()

  if (testError || !test) {
    if (previousActiveIds.length > 0) {
      await supabase.from('vocab_test').update({ is_active: true }).in('id', previousActiveIds)
    }
    return err(testError?.message ?? '시험지 생성 실패', 500)
  }

  const { error: itemError } = await supabase
    .from('vocab_test_item')
    .insert(dedupedValidItems.map((item, index) => ({
      vocab_test_id: test.id,
      vocab_word_id: item.wordId,
      vocab_word_variant_id: item.variantId,
      test_number: index + 1,
      sort_order: index + 1,
      prompt_source: item.promptSource,
      prompt_text: item.promptText || null,
    })))

  if (itemError) {
    await supabase.from('vocab_test').delete().eq('id', test.id)
    if (previousActiveIds.length > 0) {
      await supabase.from('vocab_test').update({ is_active: true }).in('id', previousActiveIds)
    }
    return err(itemError.message, 500)
  }

  if (!sameSelection) {
    const { data: scores } = await supabase
      .from('week_score')
      .select('id')
      .eq('week_id', weekId)
    const scoreIds = (scores ?? []).map((score) => score.id)
    if (scoreIds.length > 0) {
      await supabase.from('student_vocab_answer').delete().in('week_score_id', scoreIds)
      await supabase
        .from('week_score')
        .update({ vocab_correct: null, vocab_retake_correct: null, vocab_photo_path: null })
        .in('id', scoreIds)
    }
  }

  await supabase.from('week').update({ vocab_total: dedupedValidItems.length }).eq('id', weekId)

  return ok({ ok: true, test: { ...test, item_count: dedupedValidItems.length } }, { status: 201 })
}
