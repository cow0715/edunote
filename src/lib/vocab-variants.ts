import { jsonrepair } from 'jsonrepair'
import { anthropic } from '@/lib/anthropic'
import type { ParsedVocabEntry } from '@/lib/vocab-xlsx'

export type VocabVariantRelationType = 'original' | 'synonym' | 'derivative' | 'antonym'

export type VocabVariantInput = {
  word: string
  part_of_speech: string | null
  meaning: string | null
  relation_type: VocabVariantRelationType
  usage_note: string | null
  excluded_meanings: string[]
  raw_text: string | null
  exam_enabled: boolean
  needs_review: boolean
  confidence: number | null
  sort_order: number
}

export type VocabEntryWithVariants = ParsedVocabEntry & {
  variants: VocabVariantInput[]
}

type AiVariant = {
  source_word: string
  word: string
  relation_type: VocabVariantRelationType
  part_of_speech?: string | null
  meaning?: string | null
  usage_note?: string | null
  excluded_meanings?: string[]
  needs_review?: boolean
  confidence?: number | null
}

const POS_PATTERN = /\b(n|v|a|ad|adj|adv|prep|conj|phr|phrase)\.?\b/i
const EMPTY_PATTERN = /^(?:-|—|–|none|없음|해당없음|n\/a)$/i

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizePos(value: unknown) {
  const text = cleanText(value).toLowerCase().replace(/[()]/g, '').replace(/\s+/g, '')
  if (!text) return null
  if (text === 'adj' || text === 'a') return 'a.'
  if (text === 'adv' || text === 'ad') return 'ad.'
  if (text === 'noun' || text === 'n') return 'n.'
  if (text === 'verb' || text === 'v') return 'v.'
  if (text === 'prep') return 'prep.'
  if (text === 'conj') return 'conj.'
  if (text === 'phr' || text === 'phrase') return 'phr.'
  return cleanText(value) || null
}

function stripArrow(value: string) {
  return value.replace(/^[↔=<>→←\s]+/, '').trim()
}

function splitNote(value: string) {
  const [main, ...notes] = value.split('※')
  return {
    main: cleanText(main),
    note: cleanText(notes.join(' ※ ')) || null,
  }
}

function extractExcludedMeanings(note: string | null) {
  if (!note) return []
  const quoted = [...note.matchAll(/["“”']([^"“”']+)["“”']/g)].map((match) => cleanText(match[1]))
  if (/의미\s*아님|뜻\s*아님|아님/.test(note)) return quoted.filter(Boolean)
  return []
}

function splitItems(value: unknown) {
  const text = cleanText(value)
  if (!text || EMPTY_PATTERN.test(text)) return []
  return text
    .split(/\s*(?:\/|,|;)\s*/g)
    .map((item) => cleanText(item))
    .filter((item) => item && !EMPTY_PATTERN.test(item))
}

function parseItem(rawValue: string, relationType: VocabVariantRelationType, fallbackMeaning: string | null): VocabVariantInput | null {
  const rawText = cleanText(rawValue)
  if (!rawText || EMPTY_PATTERN.test(rawText)) return null

  const { main, note } = splitNote(stripArrow(rawText))
  const posMatch = main.match(/\(([^)]*?)\)/)
  const pos = posMatch && POS_PATTERN.test(posMatch[1]) ? normalizePos(posMatch[1]) : null
  const word = cleanText(main.replace(/\([^)]*?\)/g, ' ').replace(/[↔=<>→←]/g, ' '))
    .replace(/^[^\w'-]+|[^\w'-]+$/g, '')

  if (!word || !/[A-Za-z]/.test(word)) return null

  return {
    word,
    part_of_speech: pos,
    meaning: relationType === 'synonym' ? fallbackMeaning : null,
    relation_type: relationType,
    usage_note: note,
    excluded_meanings: extractExcludedMeanings(note),
    raw_text: rawText,
    exam_enabled: relationType !== 'antonym',
    needs_review: relationType !== 'synonym',
    confidence: null,
    sort_order: 0,
  }
}

function dedupeVariants(variants: VocabVariantInput[]) {
  const seen = new Set<string>()
  return variants.filter((variant) => {
    const key = `${variant.relation_type}:${variant.word.toLowerCase()}:${variant.part_of_speech ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((variant, index) => ({ ...variant, sort_order: index + 1 }))
}

export function buildRuleBasedVariants(entry: ParsedVocabEntry): VocabVariantInput[] {
  const originalParsed = parseItem(
    [entry.english_word, entry.part_of_speech ? `(${entry.part_of_speech})` : null].filter(Boolean).join(' '),
    'original',
    entry.correct_answer,
  )
  const variants: VocabVariantInput[] = []

  if (originalParsed) {
    variants.push({
      ...originalParsed,
      part_of_speech: normalizePos(entry.part_of_speech) ?? originalParsed.part_of_speech,
      meaning: entry.correct_answer,
      needs_review: !entry.correct_answer,
      confidence: entry.correct_answer ? 0.95 : null,
    })
  }

  for (const synonym of entry.synonyms ?? []) {
    const parsed = parseItem(synonym, 'synonym', entry.correct_answer)
    if (parsed) variants.push({ ...parsed, confidence: entry.correct_answer ? 0.75 : null })
  }

  for (const derivative of splitItems(entry.derivatives)) {
    const [derivativeText, ...antonymParts] = derivative.split(/[↔]/)
    const parsed = parseItem(derivativeText, 'derivative', null)
    if (parsed) variants.push(parsed)
    for (const antonymText of antonymParts) {
      const antonym = parseItem(antonymText, 'antonym', null)
      if (antonym) variants.push(antonym)
    }
  }

  for (const antonym of entry.antonyms ?? []) {
    const parsed = parseItem(antonym, 'antonym', null)
    if (parsed) variants.push(parsed)
  }

  return dedupeVariants(variants)
}

function mergeAiVariant(base: VocabVariantInput, ai?: AiVariant): VocabVariantInput {
  if (!ai) return base
  const meaning = cleanText(ai.meaning) || base.meaning
  const partOfSpeech = normalizePos(ai.part_of_speech) ?? base.part_of_speech
  const usageNote = cleanText(ai.usage_note) || base.usage_note
  return {
    ...base,
    part_of_speech: partOfSpeech,
    meaning,
    usage_note: usageNote,
    excluded_meanings: Array.isArray(ai.excluded_meanings) ? ai.excluded_meanings.map(cleanText).filter(Boolean) : base.excluded_meanings,
    needs_review: Boolean(ai.needs_review ?? (!meaning || base.needs_review)),
    confidence: typeof ai.confidence === 'number' ? ai.confidence : (meaning ? 0.8 : base.confidence),
  }
}

async function enrichVariantsWithAi(entries: VocabEntryWithVariants[]) {
  if (!process.env.ANTHROPIC_API_KEY) return entries

  const payload = entries.map((entry) => ({
    source_word: entry.english_word,
    source_meaning: entry.correct_answer,
    passage_label: entry.passage_label,
    variants: entry.variants.map((variant) => ({
      word: variant.word,
      relation_type: variant.relation_type,
      part_of_speech: variant.part_of_speech,
      meaning: variant.meaning,
      usage_note: variant.usage_note,
      raw_text: variant.raw_text,
    })),
  }))

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 12000,
    messages: [{
      role: 'user',
      content: `You normalize English vocabulary for Korean students. Return JSON only.

Rules:
- Preserve source_word and word exactly as provided unless there is obvious surrounding punctuation.
- Fill part_of_speech using n., v., a., ad., prep., conj., phr. when clear.
- Fill Korean meaning for each word in the vocabulary-study context.
- Do not copy the source meaning to derivatives when the meaning changes.
- Text after ※ or phrases like "의미 아님" are usage notes, not meanings.
- If a note says a meaning is not intended, put that Korean meaning in excluded_meanings.
- relation_type antonym should usually exam_enabled false conceptually, but still fill its meaning.
- Set needs_review true when the meaning or POS is uncertain.
- confidence is 0 to 1.

Input:
${JSON.stringify(payload)}

Output shape:
[
  {
    "source_word": "argue",
    "word": "argue",
    "relation_type": "original",
    "part_of_speech": "v.",
    "meaning": "주장하다",
    "usage_note": "\\"다툼\\" 의미 아님",
    "excluded_meanings": ["다툼"],
    "needs_review": false,
    "confidence": 0.92
  }
]`,
    }],
  })

  const raw = res.content[0]?.type === 'text' ? res.content[0].text : ''
  const parsed = JSON.parse(jsonrepair(raw.replace(/```json\n?|\n?```/g, '').trim())) as AiVariant[]
  const aiMap = new Map<string, AiVariant>()
  for (const item of parsed) {
    if (!item?.source_word || !item.word || !item.relation_type) continue
    aiMap.set(`${item.source_word.toLowerCase()}::${item.relation_type}::${item.word.toLowerCase()}`, item)
  }

  return entries.map((entry) => ({
    ...entry,
    variants: entry.variants.map((variant) => mergeAiVariant(
      variant,
      aiMap.get(`${entry.english_word.toLowerCase()}::${variant.relation_type}::${variant.word.toLowerCase()}`),
    )),
  }))
}

export async function normalizeVocabEntries(entries: ParsedVocabEntry[], options: { useAi?: boolean } = {}) {
  const withVariants = entries.map((entry) => ({
    ...entry,
    variants: buildRuleBasedVariants(entry),
  }))

  if (!options.useAi) return withVariants

  const normalized: VocabEntryWithVariants[] = []
  const batchSize = 40
  for (let i = 0; i < withVariants.length; i += batchSize) {
    const batch = withVariants.slice(i, i + batchSize)
    try {
      normalized.push(...await enrichVariantsWithAi(batch))
    } catch (error) {
      console.error('[vocab-variants] AI normalization failed; using rule-based variants', error)
      normalized.push(...batch)
    }
  }

  return normalized
}
