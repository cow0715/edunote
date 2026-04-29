import { jsonrepair } from 'jsonrepair'
import type { SupabaseServerClient } from '@/lib/api'
import { anthropic } from '@/lib/anthropic'

export type VocabEnrichmentCandidate = {
  word: string
  normalized_word: string
  meaning: string
  topic: string
}

export type VocabEnrichment = {
  normalized_word: string
  word: string
  meaning_sample: string
  topic: string
  synonyms: string[]
  antonyms: string[]
  similar_words: string[]
}

const ENRICHMENT_MODEL = 'claude-haiku-4-5-20251001'
const TOPICS = ['과학/기술', '환경/생태', '경제/사회', '심리/인지', '예술/문화', '교육/학습', '일상/실용', '어휘', '어법', '기타']

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

function normalizeTopic(topic: unknown) {
  if (typeof topic !== 'string') return '기타'
  return TOPICS.includes(topic) ? topic : '기타'
}

function parseEnrichmentResponse(raw: string, candidates: VocabEnrichmentCandidate[]) {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  const parsed = JSON.parse(jsonrepair(cleaned)) as unknown
  if (!Array.isArray(parsed)) return []

  const candidateMap = new Map(candidates.map((candidate) => [candidate.normalized_word, candidate]))
  const rows: VocabEnrichment[] = []

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const data = item as Record<string, unknown>
    const normalizedWord = typeof data.normalized_word === 'string' ? data.normalized_word.trim() : ''
    const candidate = candidateMap.get(normalizedWord)
    if (!candidate) continue

    rows.push({
      normalized_word: candidate.normalized_word,
      word: candidate.word,
      meaning_sample: candidate.meaning,
      topic: normalizeTopic(data.topic || candidate.topic),
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

export async function getOrCreateVocabEnrichments(
  supabase: SupabaseServerClient,
  candidates: VocabEnrichmentCandidate[],
  options: { generateLimit?: number; batchSize?: number } = {},
) {
  const byWord = new Map<string, VocabEnrichmentCandidate>()
  for (const candidate of candidates) {
    if (!candidate.normalized_word || byWord.has(candidate.normalized_word)) continue
    byWord.set(candidate.normalized_word, candidate)
  }

  const uniqueCandidates = [...byWord.values()]
  if (uniqueCandidates.length === 0) return new Map<string, VocabEnrichment>()

  const { data: existingRaw, error: existingError } = await supabase
    .from('vocab_enrichment')
    .select('normalized_word, word, meaning_sample, topic, synonyms, antonyms, similar_words')
    .in('normalized_word', uniqueCandidates.map((candidate) => candidate.normalized_word))

  if (existingError) throw new Error(existingError.message)

  const enrichments = new Map<string, VocabEnrichment>()
  for (const row of (existingRaw ?? []) as VocabEnrichment[]) {
    enrichments.set(row.normalized_word, {
      ...row,
      synonyms: row.synonyms ?? [],
      antonyms: row.antonyms ?? [],
      similar_words: row.similar_words ?? [],
    })
  }

  const missing = uniqueCandidates
    .filter((candidate) => !enrichments.has(candidate.normalized_word))
    .slice(0, options.generateLimit ?? 120)

  const generated: VocabEnrichment[] = []
  const batchSize = options.batchSize ?? 40
  for (let i = 0; i < missing.length; i += batchSize) {
    generated.push(...await generateEnrichments(missing.slice(i, i + batchSize)))
  }

  if (generated.length > 0) {
    const { error: upsertError } = await supabase
      .from('vocab_enrichment')
      .upsert(generated.map((row) => ({
        ...row,
        model: ENRICHMENT_MODEL,
        updated_at: new Date().toISOString(),
      })), { onConflict: 'normalized_word' })

    if (upsertError) throw new Error(upsertError.message)
    for (const row of generated) enrichments.set(row.normalized_word, row)
  }

  return enrichments
}
