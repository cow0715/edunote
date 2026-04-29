import { jsonrepair } from 'jsonrepair'
import type { SupabaseServerClient } from '@/lib/api'
import { anthropic } from '@/lib/anthropic'

export type VocabEnrichmentCandidate = {
  normalized_word: string
  word: string
  meaning: string
  topic: string
}

export type VocabEnrichmentResult = {
  normalized_word: string
  topic: string
  synonyms: string[]
  antonyms: string[]
  similar_words: string[]
}

const ENRICHMENT_MODEL = 'claude-haiku-4-5-20251001'
const TOPICS = ['과학/기술', '환경/생태', '경제/사회', '심리/인지', '예술/문화', '교육/학습', '일상/실용', '어휘', '어법', '기타']

type VocabDbRow = VocabEnrichmentCandidate & {
  id: string
  synonyms: string[] | null
  antonyms: string[] | null
  similar_words: string[] | null
}

function uniqueClean(values: unknown, max = 4) {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    result.push(text)
    if (result.length >= max) break
  }

  return result
}

function normalizeTopic(topic: unknown, fallback = '기타') {
  if (typeof topic !== 'string') return fallback
  return TOPICS.includes(topic) ? topic : fallback
}

function needsEnrichment(row: VocabDbRow) {
  return (
    !row.synonyms?.length
    && !row.antonyms?.length
    && !row.similar_words?.length
  )
}

function parseEnrichmentResponse(raw: string, candidates: VocabEnrichmentCandidate[]) {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  const parsed = JSON.parse(jsonrepair(cleaned)) as unknown
  if (!Array.isArray(parsed)) return []

  const candidateMap = new Map(candidates.map((candidate) => [candidate.normalized_word, candidate]))
  const rows: VocabEnrichmentResult[] = []

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const data = item as Record<string, unknown>
    const normalizedWord = typeof data.normalized_word === 'string' ? data.normalized_word.trim() : ''
    const candidate = candidateMap.get(normalizedWord)
    if (!candidate) continue

    rows.push({
      normalized_word: candidate.normalized_word,
      topic: normalizeTopic(data.topic, candidate.topic),
      synonyms: uniqueClean(data.synonyms, 4),
      antonyms: uniqueClean(data.antonyms, 4),
      similar_words: uniqueClean(data.similar_words, 5),
    })
  }

  return rows
}

async function generateEnrichments(candidates: VocabEnrichmentCandidate[]) {
  if (candidates.length === 0 || !process.env.ANTHROPIC_API_KEY) return []

  const prompt = `다음 수능/모의고사 영어 어휘를 단어장용으로 보강하세요.

규칙:
- JSON 배열만 출력하세요.
- normalized_word는 입력값을 그대로 반환하세요.
- topic은 반드시 다음 중 하나만 선택하세요: ${TOPICS.join(', ')}
- synonyms, antonyms, similar_words는 영어 단어/구만 넣으세요.
- 한국 고2~고3 영어 학습자가 같이 외우기 좋은 것만 고르세요.
- 불확실하면 빈 배열을 쓰세요.
- synonyms는 유의어, antonyms는 반의어, similar_words는 뜻/쓰임/주제가 가까운 관련어입니다.
- 각 배열은 중복 없이 4개 이내로 제한하세요.

입력:
${JSON.stringify(candidates.map((candidate) => ({
  normalized_word: candidate.normalized_word,
  word: candidate.word,
  meaning: candidate.meaning,
  current_topic: candidate.topic,
})))}

출력 형식:
[
  {
    "normalized_word": "accurate",
    "topic": "과학/기술",
    "synonyms": ["precise", "exact"],
    "antonyms": ["inaccurate"],
    "similar_words": ["reliable", "valid"]
  }
]`

  const response = await anthropic.messages.create({
    model: ENRICHMENT_MODEL,
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw = response.content[0]?.type === 'text' ? response.content[0].text : ''
  return parseEnrichmentResponse(raw, candidates)
}

export async function enrichExamQuestionVocabulary(
  supabase: SupabaseServerClient,
  options: { normalizedWords?: string[]; limit?: number; batchSize?: number } = {},
) {
  const normalizedWords = [...new Set((options.normalizedWords ?? []).filter(Boolean))]
  let query = supabase
    .from('exam_bank_question_vocab')
    .select('id, normalized_word, word, meaning, topic, synonyms, antonyms, similar_words')
    .order('created_at', { ascending: true })
    .limit(options.limit ?? 200)

  if (normalizedWords.length > 0) {
    query = query.in('normalized_word', normalizedWords)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const rows = ((data ?? []) as VocabDbRow[]).filter(needsEnrichment)
  const byWord = new Map<string, VocabEnrichmentCandidate>()
  for (const row of rows) {
    if (!byWord.has(row.normalized_word)) {
      byWord.set(row.normalized_word, {
        normalized_word: row.normalized_word,
        word: row.word,
        meaning: row.meaning,
        topic: row.topic || '기타',
      })
    }
  }

  const candidates = [...byWord.values()]
  const generated: VocabEnrichmentResult[] = []
  const batchSize = options.batchSize ?? 40
  for (let i = 0; i < candidates.length; i += batchSize) {
    generated.push(...await generateEnrichments(candidates.slice(i, i + batchSize)))
  }

  let updated = 0
  for (const result of generated) {
    const { data: updatedRows, error: updateError } = await supabase
      .from('exam_bank_question_vocab')
      .update({
        topic: result.topic,
        synonyms: result.synonyms,
        antonyms: result.antonyms,
        similar_words: result.similar_words,
      })
      .eq('normalized_word', result.normalized_word)
      .select('id')

    if (updateError) throw new Error(updateError.message)
    updated += updatedRows?.length ?? 0
  }

  return { candidates: candidates.length, generated: generated.length, updated }
}
