import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'

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
  test_number: number
  sort_order: number
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
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
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
        .select('id, vocab_test_id, vocab_word_id, test_number, sort_order, vocab_word(id, number, passage_label, english_word, part_of_speech, correct_answer, synonyms, antonyms, derivatives)')
        .in('vocab_test_id', testIds)
        .order('sort_order')
    : { data: [], error: null }

  if (itemError) return err(itemError.message, 500)

  const itemsByTestId = new Map<string, VocabTestItemRow[]>()
  for (const item of (items ?? []) as unknown as VocabTestItemRow[]) {
    const list = itemsByTestId.get(item.vocab_test_id) ?? []
    list.push({ ...item, vocab_word: one(item.vocab_word) })
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
  }
  const wordIds = [...new Set((body.wordIds ?? []).filter(Boolean))]
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

  await supabase.from('vocab_test').update({ is_active: false }).eq('week_id', weekId)

  const { data: test, error: testError } = await supabase
    .from('vocab_test')
    .insert({
      week_id: weekId,
      title: body.title?.trim() || '단어시험',
      is_active: true,
      item_count: validWordIds.length,
    })
    .select('id, week_id, title, is_active, item_count, created_at')
    .single()

  if (testError || !test) return err(testError?.message ?? '시험지 생성 실패', 500)

  const { error: itemError } = await supabase
    .from('vocab_test_item')
    .insert(validWordIds.map((vocabWordId, index) => ({
      vocab_test_id: test.id,
      vocab_word_id: vocabWordId,
      test_number: index + 1,
      sort_order: index + 1,
    })))

  if (itemError) {
    await supabase.from('vocab_test').delete().eq('id', test.id)
    return err(itemError.message, 500)
  }

  await supabase.from('week').update({ vocab_total: validWordIds.length }).eq('id', weekId)

  return ok({ ok: true, test: { ...test, item_count: validWordIds.length } }, { status: 201 })
}
