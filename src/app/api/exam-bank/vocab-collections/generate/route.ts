import { getAuth, getTeacherId, err, ok } from '@/lib/api'

export const maxDuration = 60

type ExamRow = {
  id: string
  exam_year: number
  exam_month: number
  grade: number
  source: string
}

type QuestionRow = {
  id: string
  exam_bank_id: string
  question_number: number
  question_type: string
  passage: string | null
}

type VocabRow = {
  question_id: string
  word: string
  normalized_word: string
  meaning: string
  topic: string
  synonyms: string[] | null
  antonyms: string[] | null
  similar_words: string[] | null
}

type SourceRef = {
  exam_id: string
  question_id: string
  year: number
  month: number
  grade: number
  source: string
  question_number: number
}

type VocabBucket = {
  word: string
  normalized_word: string
  meanings: Map<string, number>
  questionIds: Set<string>
  sources: SourceRef[]
  topicCounts: Map<string, number>
  synonyms: Set<string>
  antonyms: Set<string>
  similarWords: Set<string>
}

function sameMonths(a: number[] | null | undefined, b: number[]) {
  const aa = [...(a ?? [])].map(Number).sort((x, y) => x - y)
  const bb = [...b].map(Number).sort((x, y) => x - y)
  return aa.length === bb.length && aa.every((value, index) => value === bb[index])
}

function topValue(counts: Map<string, number>) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
}

function topMeanings(meanings: Map<string, number>) {
  return [...meanings.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([meaning]) => meaning)
    .join(' / ')
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
  return chunks
}

async function fetchQuestionVocabulary(
  supabase: Awaited<ReturnType<typeof getAuth>>['supabase'],
  questionIds: string[],
) {
  const rows: VocabRow[] = []

  for (const ids of chunkRows(questionIds, 200)) {
    let from = 0
    const pageSize = 1000

    while (true) {
      const { data, error } = await supabase
        .from('exam_bank_question_vocab')
        .select('question_id, word, normalized_word, meaning, topic, synonyms, antonyms, similar_words')
        .in('question_id', ids)
        .range(from, from + pageSize - 1)

      if (error) throw new Error(error.message)
      rows.push(...((data ?? []) as VocabRow[]))
      if (!data || data.length < pageSize) break
      from += pageSize
    }
  }

  return rows
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('선생님 정보 없음', 403)

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const currentYear = new Date().getFullYear()
  const yearTo = Number(body.year_to ?? currentYear - 1)
  const yearFrom = Number(body.year_from ?? yearTo - 4)
  const grade = Number(body.grade ?? 3)
  const months: number[] = Array.isArray(body.months) && body.months.length > 0
    ? body.months.map(Number).filter((m) => Number.isFinite(m))
    : [6, 9, 11]
  const sortedMonths = [...new Set(months)].sort((a, b) => a - b)
  const forceRegenerate = body.force_regenerate === true

  if (!Number.isFinite(yearFrom) || !Number.isFinite(yearTo) || yearFrom > yearTo) {
    return err('연도 범위를 확인해주세요')
  }
  if (!sortedMonths.length) return err('월 범위를 확인해주세요')

  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : `${yearFrom}-${yearTo}년 6·9·수능 기출 어휘`

  const { data: existingCollections, error: existingError } = await supabase
    .from('vocab_collection')
    .select('id, title, grade, year_from, year_to, months, item_count, created_at')
    .eq('teacher_id', teacherId)
    .eq('grade', grade)
    .eq('year_from', yearFrom)
    .eq('year_to', yearTo)

  if (existingError) return err(existingError.message, 500)
  const existingCollection = (existingCollections ?? []).find((collection) => sameMonths(collection.months as number[], sortedMonths))
  if (existingCollection && !forceRegenerate) {
    return ok({ duplicate: true, existing: existingCollection })
  }

  const { data: exams, error: examError } = await supabase
    .from('exam_bank')
    .select('id, exam_year, exam_month, grade, source')
    .eq('teacher_id', teacherId)
    .eq('grade', grade)
    .gte('exam_year', yearFrom)
    .lte('exam_year', yearTo)
    .in('exam_month', sortedMonths)

  if (examError) return err(examError.message, 500)
  const examRows = (exams ?? []) as ExamRow[]
  if (examRows.length === 0) return err('조건에 맞는 시험이 없습니다', 404)

  const examMap = new Map(examRows.map((exam) => [exam.id, exam]))
  const { data: questions, error: questionError } = await supabase
    .from('exam_bank_question')
    .select('id, exam_bank_id, question_number, question_type, passage')
    .in('exam_bank_id', examRows.map((exam) => exam.id))

  if (questionError) return err(questionError.message, 500)
  const questionRows = (questions ?? []) as QuestionRow[]
  if (questionRows.length === 0) return err('조건에 맞는 문항이 없습니다', 404)

  const questionMap = new Map(questionRows.map((question) => [question.id, question]))

  const questionIds = questionRows.map((question) => question.id)
  let vocabRows: VocabRow[]
  try {
    vocabRows = await fetchQuestionVocabulary(supabase, questionIds)
  } catch (error) {
    return err(error instanceof Error ? error.message : '어휘 조회 실패', 500)
  }
  if (vocabRows.length === 0) {
    return err('구조화된 어휘가 없습니다. 먼저 어휘 데이터 백필을 실행해주세요.', 422)
  }

  const buckets = new Map<string, VocabBucket>()
  for (const vocab of vocabRows) {
    const question = questionMap.get(vocab.question_id)
    if (!question) continue
    const exam = examMap.get(question.exam_bank_id)
    if (!exam) continue

    const bucket = buckets.get(vocab.normalized_word) ?? {
      word: vocab.word,
      normalized_word: vocab.normalized_word,
      meanings: new Map<string, number>(),
      questionIds: new Set<string>(),
      sources: [],
      topicCounts: new Map<string, number>(),
      synonyms: new Set<string>(),
      antonyms: new Set<string>(),
      similarWords: new Set<string>(),
    }

    bucket.meanings.set(vocab.meaning, (bucket.meanings.get(vocab.meaning) ?? 0) + 1)
    bucket.questionIds.add(question.id)
    bucket.sources.push({
      exam_id: exam.id,
      question_id: question.id,
      year: exam.exam_year,
      month: exam.exam_month,
      grade: exam.grade,
      source: exam.source,
      question_number: question.question_number,
    })
    bucket.topicCounts.set(vocab.topic, (bucket.topicCounts.get(vocab.topic) ?? 0) + 1)
    for (const synonym of vocab.synonyms ?? []) bucket.synonyms.add(synonym)
    for (const antonym of vocab.antonyms ?? []) bucket.antonyms.add(antonym)
    for (const similarWord of vocab.similar_words ?? []) bucket.similarWords.add(similarWord)
    buckets.set(vocab.normalized_word, bucket)
  }

  const items = [...buckets.values()]
    .map((bucket) => ({
      word: bucket.word,
      normalized_word: bucket.normalized_word,
      meaning: topMeanings(bucket.meanings),
      frequency: bucket.questionIds.size,
      topic: topValue(bucket.topicCounts) || '기타',
      synonyms: [...bucket.synonyms],
      antonyms: [...bucket.antonyms],
      similar_words: [...bucket.similarWords],
      sources: bucket.sources
        .sort((a, b) => b.year - a.year || b.month - a.month || a.question_number - b.question_number)
        .slice(0, 20),
    }))
    .filter((item) => item.meaning)
    .sort((a, b) => b.frequency - a.frequency || a.topic.localeCompare(b.topic) || a.word.localeCompare(b.word))

  if (items.length === 0) return err('추출할 어휘가 없습니다. 해설의 Words & Phrases를 먼저 채워주세요.', 422)

  if (existingCollection && forceRegenerate) {
    const { error: deleteError } = await supabase
      .from('vocab_collection')
      .delete()
      .eq('id', existingCollection.id)
      .eq('teacher_id', teacherId)
    if (deleteError) return err(deleteError.message, 500)
  }

  const { data: collection, error: collectionError } = await supabase
    .from('vocab_collection')
    .insert({
      teacher_id: teacherId,
      title,
      grade,
      year_from: yearFrom,
      year_to: yearTo,
      months: sortedMonths,
      item_count: items.length,
    })
    .select('id')
    .single()

  if (collectionError || !collection) return err(collectionError?.message ?? '단어장 저장 실패', 500)

  const rows = items.map((item, index) => ({
    collection_id: collection.id,
    word: item.word,
    meaning: item.meaning,
    frequency: item.frequency,
    topic: item.topic,
    synonyms: item.synonyms,
    antonyms: item.antonyms,
    similar_words: item.similar_words,
    sources: item.sources,
    sort_order: index + 1,
  }))

  for (const chunk of chunkRows(rows, 500)) {
    const { error: itemError } = await supabase.from('vocab_collection_item').insert(chunk)
    if (itemError) {
      await supabase.from('vocab_collection').delete().eq('id', collection.id)
      return err(itemError.message, 500)
    }
  }

  return ok({ id: collection.id, item_count: items.length, title })
}
