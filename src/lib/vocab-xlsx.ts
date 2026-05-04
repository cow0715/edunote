import * as XLSX from 'xlsx'

export type ParsedVocabEntry = {
  number: number
  passage_label: string | null
  english_word: string
  part_of_speech: string | null
  correct_answer: string | null
  synonyms: string[]
  antonyms: string[]
  derivatives: string | null
  source_row_index: number
}

type HeaderKey = keyof Omit<ParsedVocabEntry, 'number' | 'source_row_index' | 'synonyms' | 'antonyms' | 'correct_answer'> | 'meaning' | 'synonyms' | 'antonyms'

const HEADER_ALIASES: Record<HeaderKey, string[]> = {
  passage_label: ['지문', '문항', '번호'],
  english_word: ['본문단어', '단어', '영어단어', 'word', 'englishword'],
  part_of_speech: ['품사', 'pos', 'partofspeech'],
  meaning: ['본문의미', '뜻', '의미', '한국어뜻', 'meaning'],
  synonyms: ['문맥동의어', '유의어', '동의어', 'synonym', 'synonyms'],
  derivatives: ['파생어변형주의', '파생어/변형주의', '파생어', '변형주의', 'derivatives'],
  antonyms: ['반의어', 'antonym', 'antonyms'],
}

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()_\-·/]+/g, '')
}

function cleanText(value: unknown) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text || /^[—–\-]+$/.test(text)) return ''
  return text
}

function cleanNullable(value: unknown) {
  const text = cleanText(value)
  return text.length > 0 ? text : null
}

function splitList(value: unknown) {
  const text = cleanText(value)
    .replace(/[↔⇔]/g, '')
    .replace(/^[,;/\s]+|[,;/\s]+$/g, '')
  if (!text) return []

  return text
    .split(/[,;/]+/)
    .map((item) => cleanText(item).replace(/^[↔⇔\s]+/, '').trim())
    .filter(Boolean)
}

function findColumn(headerRow: unknown[], key: HeaderKey) {
  const aliases = new Set(HEADER_ALIASES[key].map(normalizeHeader))
  return headerRow.findIndex((cell) => aliases.has(normalizeHeader(cell)))
}

function findHeader(rows: unknown[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
    const row = rows[rowIndex] ?? []
    const wordCol = findColumn(row, 'english_word')
    const meaningCol = findColumn(row, 'meaning')
    if (wordCol >= 0 && meaningCol >= 0) {
      return {
        rowIndex,
        columns: {
          passage_label: findColumn(row, 'passage_label'),
          english_word: wordCol,
          part_of_speech: findColumn(row, 'part_of_speech'),
          meaning: meaningCol,
          synonyms: findColumn(row, 'synonyms'),
          derivatives: findColumn(row, 'derivatives'),
          antonyms: findColumn(row, 'antonyms'),
        },
      }
    }
  }
  return null
}

function cell(row: unknown[], index: number) {
  return index >= 0 ? row[index] : ''
}

export function parseVocabRows(rows: unknown[][]): ParsedVocabEntry[] {
  const header = findHeader(rows)
  if (!header) {
    throw new Error('본문 단어/본문 의미 헤더가 있는 시트를 찾을 수 없습니다.')
  }

  const words: ParsedVocabEntry[] = []
  let currentPassage: string | null = null

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? []
    const passage = cleanNullable(cell(row, header.columns.passage_label))
    const englishWord = cleanText(cell(row, header.columns.english_word))

    if (!englishWord) {
      if (passage) currentPassage = passage.replace(/\.$/, '')
      continue
    }

    const rowPassage = passage ? passage.replace(/\.$/, '') : currentPassage
    words.push({
      number: words.length + 1,
      passage_label: rowPassage,
      english_word: englishWord,
      part_of_speech: cleanNullable(cell(row, header.columns.part_of_speech)),
      correct_answer: cleanNullable(cell(row, header.columns.meaning)),
      synonyms: splitList(cell(row, header.columns.synonyms)),
      antonyms: splitList(cell(row, header.columns.antonyms)),
      derivatives: cleanNullable(cell(row, header.columns.derivatives)),
      source_row_index: rowIndex + 1,
    })
  }

  return words
}

export function parseVocabWorkbookBuffer(buffer: Buffer | ArrayBuffer | Uint8Array): ParsedVocabEntry[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    })

    if (findHeader(rows)) return parseVocabRows(rows)
  }

  throw new Error('단어장 형식의 시트를 찾을 수 없습니다.')
}
