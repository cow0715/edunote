import type { SupabaseServerClient } from '@/lib/api'

export type ParsedExamVocabulary = {
  word: string
  normalized_word: string
  meaning: string
  topic: string
}

const TOPIC_KEYWORDS: Array<[string, string[]]> = [
  ['과학/기술', ['science', 'scientific', 'technology', 'digital', 'data', 'neuron', 'organism', 'stimulus', 'evolution', '연구', '과학', '기술', '신경', '생물', '진화']],
  ['환경/생태', ['environment', 'wildlife', 'organic', 'contamination', 'emission', 'resource', 'climate', '환경', '생태', '오염', '배출', '기후', '자원']],
  ['경제/사회', ['market', 'finance', 'income', 'budget', 'trade', 'company', 'publication', 'copyright', '사회', '경제', '시장', '재정', '무역', '회사', '권리']],
  ['심리/인지', ['motivation', 'perception', 'memory', 'preference', 'bias', 'subjective', 'emotion', '심리', '인지', '기억', '선호', '감정', '인식']],
  ['예술/문화', ['art', 'artist', 'imagery', 'narrative', 'adaptation', 'film', 'music', '예술', '문화', '영화', '이야기', '이미지']],
  ['교육/학습', ['education', 'student', 'school', 'literacy', 'learn', 'practice', '교육', '학생', '학교', '학습', '연습']],
  ['일상/실용', ['reservation', 'registration', 'purchase', 'donation', 'semester', '일상', '예약', '등록', '구매', '기부']],
]

const QUESTION_TYPE_TOPIC: Record<string, string> = {
  notice: '일상/실용',
  content_match: '일상/실용',
  vocabulary: '어휘',
  blank_vocabulary: '어휘',
  grammar: '어법',
  blank_grammar: '어법',
}

export function normalizeExamVocabWord(word: string) {
  return word
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanupWord(word: string) {
  return word
    .replace(/^[\s\-•*·]+/, '')
    .replace(/[\s:;,\-–—(/]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanupMeaning(meaning: string) {
  return meaning
    .replace(/^[\s:;,\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitVocabulary(text: string) {
  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/[|]/g, ' / ')
    .replace(/\s+\/\s+/g, '\n')
    .replace(/\s{3,}/g, '\n')

  return normalized
    .split(/\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
}

function findKoreanIndex(text: string, start: number) {
  const m = /[가-힣ㄱ-ㅎㅏ-ㅣ]/.exec(text.slice(start))
  return m ? start + m.index : -1
}

function findEnglishIndex(text: string, start: number) {
  const m = /[a-zA-Z]/.exec(text.slice(start))
  return m ? start + m.index : -1
}

function findNextEntryStart(text: string, meaningStart: number) {
  const re = /\s+[a-zA-Z]/g
  re.lastIndex = meaningStart

  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const candidateStart = match.index + match[0].search(/[a-zA-Z]/)
    const candidateKorean = findKoreanIndex(text, candidateStart)
    if (candidateKorean < 0) continue

    const candidateWord = cleanupWord(text.slice(candidateStart, candidateKorean))
    const currentMeaning = text.slice(meaningStart, candidateStart)
    if (!/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(currentMeaning)) continue
    if (!/[a-zA-Z]/.test(candidateWord)) continue
    if (candidateWord.length > 80) continue

    return candidateStart
  }

  return -1
}

function inferTopic(questionType: string | null | undefined, passage: string | null | undefined, meaning: string) {
  const fallback = questionType ? QUESTION_TYPE_TOPIC[questionType] : undefined
  const haystack = `${passage ?? ''} ${meaning}`.toLowerCase()
  let bestTopic = fallback ?? '기타'
  let bestScore = 0

  for (const [topic, keywords] of TOPIC_KEYWORDS) {
    const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword.toLowerCase()) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      bestTopic = topic
    }
  }
  return bestTopic
}

function parseVocabularyChunk(chunk: string, questionType?: string | null, passage?: string | null) {
  const entries: ParsedExamVocabulary[] = []
  let cursor = 0

  while (cursor < chunk.length) {
    const wordStart = findEnglishIndex(chunk, cursor)
    if (wordStart < 0) break

    const meaningStart = findKoreanIndex(chunk, wordStart)
    if (meaningStart <= wordStart) break

    const nextEntryStart = findNextEntryStart(chunk, meaningStart)
    const word = cleanupWord(chunk.slice(wordStart, meaningStart))
    const meaning = cleanupMeaning(chunk.slice(meaningStart, nextEntryStart > -1 ? nextEntryStart : chunk.length))
    const normalized_word = normalizeExamVocabWord(word)

    if (normalized_word && meaning && /[a-zA-Z]/.test(word) && !/\d/.test(word) && word.length <= 80) {
      entries.push({
        word,
        normalized_word,
        meaning,
        topic: inferTopic(questionType, passage, meaning),
      })
    }

    if (nextEntryStart < 0) break
    cursor = nextEntryStart
  }

  return entries
}

export function parseExamVocabulary(
  text: string | null | undefined,
  questionType?: string | null,
  passage?: string | null,
): ParsedExamVocabulary[] {
  if (!text?.trim()) return []

  const byKey = new Map<string, ParsedExamVocabulary>()
  for (const chunk of splitVocabulary(text)) {
    for (const entry of parseVocabularyChunk(chunk, questionType, passage)) {
      const key = `${entry.normalized_word}\n${entry.meaning}`
      if (!byKey.has(key)) {
        byKey.set(key, entry)
      }
    }
  }

  return [...byKey.values()]
}

export function formatExamVocabulary(rows: ParsedExamVocabulary[]) {
  return rows.map((row) => `${row.word} ${row.meaning}`).join('   ')
}

export function mergeExamVocabularyText(
  existingText: string | null | undefined,
  generatedText: string | null | undefined,
  questionType?: string | null,
  passage?: string | null,
) {
  const byWord = new Map<string, ParsedExamVocabulary>()
  for (const row of parseExamVocabulary(existingText, questionType, passage)) {
    byWord.set(row.normalized_word, row)
  }
  for (const row of parseExamVocabulary(generatedText, questionType, passage)) {
    if (!byWord.has(row.normalized_word)) byWord.set(row.normalized_word, row)
  }
  return formatExamVocabulary([...byWord.values()])
}

export async function syncExamQuestionVocabulary(
  supabase: SupabaseServerClient,
  questionId: string,
  vocabularyText: string | null | undefined,
  questionType?: string | null,
  passage?: string | null,
) {
  await supabase.from('exam_bank_question_vocab').delete().eq('question_id', questionId)

  const rows = parseExamVocabulary(vocabularyText, questionType, passage)
  if (rows.length === 0) return { inserted: 0, normalizedWords: [] as string[] }

  const { error } = await supabase
    .from('exam_bank_question_vocab')
    .insert(rows.map((row, index) => ({
      question_id: questionId,
      word: row.word,
      normalized_word: row.normalized_word,
      meaning: row.meaning,
      topic: row.topic,
      synonyms: [],
      antonyms: [],
      similar_words: [],
      sort_order: index + 1,
    })))

  if (error) throw new Error(error.message)
  return { inserted: rows.length, normalizedWords: [...new Set(rows.map((row) => row.normalized_word))] }
}
