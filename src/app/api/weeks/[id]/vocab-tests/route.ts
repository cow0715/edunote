import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse } from '@/lib/db/errors'
import { replaceVocabTest } from '@/lib/services/vocab-tests'
import { getAuth, getTeacherId, assertWeekOwner, countGradedVocabAnswers, VOCAB_LOCKED_MESSAGE, err, ok } from '@/lib/api'
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
    example_sentence: string | null
  } | { id: string; number: number; passage_label: string | null; english_word: string; part_of_speech: string | null; correct_answer: string | null; synonyms: string[] | null; antonyms: string[] | null; derivatives: string | null; example_sentence: string | null }[] | null
  vocab_word_variant: {
    id: string
    word: string
    part_of_speech: string | null
    meaning: string | null
    relation_type: string
  } | { id: string; word: string; part_of_speech: string | null; meaning: string | null; relation_type: string }[] | null
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

/** 인쇄 파트 순서. vocab-test-print-sheet 의 섹션 순서·vocab-word-setup 의 sortIdsBySection 과 같이 바꿔야 한다 */
const SECTION_RANK: Record<string, number> = {
  word: 0, synonym: 0, antonym: 0, derivative: 0, example_meaning: 1, example: 2, example_choice: 3,
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
  return { supabase: createServiceClient(), userId: user.id }
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
        .select('id, vocab_test_id, vocab_word_id, vocab_word_variant_id, test_number, sort_order, prompt_source, prompt_text, vocab_word(id, number, passage_label, english_word, part_of_speech, correct_answer, synonyms, antonyms, derivatives, example_sentence), vocab_word_variant(id, word, part_of_speech, meaning, relation_type)')
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

  // 채점된 답안 수 — 0보다 크면 출제 UI가 시험지 변경을 잠근다
  const gradedCount = await countGradedVocabAnswers(supabase, weekId)

  return ok({ tests: data, activeTest: data.find((test) => test.is_active) ?? data[0] ?? null, gradedCount })
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
        promptSource: item?.promptSource === 'synonym' || item?.promptSource === 'antonym' || item?.promptSource === 'derivative' || item?.promptSource === 'example' || item?.promptSource === 'example_meaning' || item?.promptSource === 'example_choice' ? item.promptSource : 'word',
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

  // 채점이 시작된 주차는 시험지를 바꿀 수 없다 (답안 삭제·정답 역산 어긋남 방지)
  const gradedCount = await countGradedVocabAnswers(supabase, weekId)
  if (gradedCount > 0) return err(VOCAB_LOCKED_MESSAGE(gradedCount), 409)

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
      // 예문 문항(뜻쓰기/빈칸/선택)은 variant 를 쓰지 않는다. promptText 가 가공된 예문 전체.
      if (item.promptSource === 'example' || item.promptSource === 'example_meaning' || item.promptSource === 'example_choice') {
        return { ...item, variantId: null }
      }
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
  const exampleSources = ['example', 'example_meaning', 'example_choice']
  const invalidVariantItems = validItems.filter((item) => item.promptSource !== 'word' && !exampleSources.includes(item.promptSource) && !item.variantId)
  if (invalidVariantItems.length > 0) {
    return err('선택한 유의어/반의어/파생어를 찾을 수 없습니다. 단어를 다시 랜덤 선택해주세요.', 422)
  }
  const invalidExampleItems = validItems.filter((item) => exampleSources.includes(item.promptSource) && !item.promptText)
  if (invalidExampleItems.length > 0) {
    return err('예문 문항의 예문이 비어 있습니다. 예문을 먼저 생성해주세요.', 422)
  }
  const seenPromptKeys = new Set<string>()
  const dedupedValidItems = validItems
    .filter((item) => {
      const key = normalizePromptDuplicateKey(item.promptText)
      if (!key) return true
      if (seenPromptKeys.has(key)) return false
      seenPromptKeys.add(key)
      return true
    })
    // 문항 번호 = 인쇄 시험지 파트 순서 (A 뜻쓰기 → B 예문뜻 → C 예문빈칸 → D 예문선택). 파트 안에서는 요청 순서 유지.
    // 클라이언트도 정렬해 보내지만, 번호와 종이가 어긋나면 채점이 틀어지므로 서버에서 한 번 더 보장한다.
    .map((item, index) => ({ item, index, rank: SECTION_RANK[item.promptSource] ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item)
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
        }, auth.userId)
      }
    } catch (error) {
      return saveErrorResponse(error)
    }
  }

  try {
    const test = await withTeacherTransaction(auth.userId, context => replaceVocabTest(context, weekId,
      body.title?.trim() || '단어시험', dedupedValidItems))
    return ok({ ok: true, test }, { status: 201 })
  } catch (error) { return saveErrorResponse(error) }
}
