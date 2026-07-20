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
  synonyms: ['문맥동의어', '문맥유의어', '유의어', '동의어', 'synonym', 'synonyms'],
  derivatives: ['파생어변형주의', '파생어/변형주의', '핵심파생어', '파생어', '변형주의', 'derivatives'],
  antonyms: ['반의어', 'antonym', 'antonyms'],
}

// 접두 일치를 허용하는 컬럼 — "문맥 유의어(+뜻)", "반의어(+뜻)" 같은 접미 변형 흡수
const PREFIX_MATCH_KEYS = new Set<HeaderKey>(['synonyms', 'antonyms', 'derivatives'])

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()_\-·/]+/g, '')
}

function cleanText(value: unknown) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^(?:-|—|–|none|없음|해당\s*없음|n\/a)$/i.test(text)) return ''
  if (!text || /^[—–\-]+$/.test(text)) return ''
  return text
}

function cleanNullable(value: unknown) {
  const text = cleanText(value)
  return text.length > 0 ? text : null
}

// 줄바꿈으로 나뉜 항목을 ', '로 이어 한 줄 텍스트로 정리 (파생어 등)
function cleanMultiline(value: unknown) {
  const items = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean)
  return items.length > 0 ? items.join(', ') : null
}

function splitList(value: unknown): string[] {
  // 줄바꿈으로 항목을 구분하는 형식 우선 처리 (한 줄 안에서는 기존 쉼표/세미콜론 구분 유지)
  const lines = String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 1) {
    return lines.flatMap((line) => splitList(line))
  }

  const text = cleanText(value)
    .replace(/[↔⇔]/g, '')
    .replace(/^[,;/\s]+|[,;/\s]+$/g, '')
  if (!text) return []

  if (text.includes('(')) {
    const items: string[] = []
    let depth = 0
    let current = ''
    for (const char of text) {
      if (char === '(') depth += 1
      if (char === ')' && depth > 0) depth -= 1
      if (depth === 0 && /[,;/]/.test(char)) {
        const item = cleanText(current).replace(/^[?붴뇯\s]+/, '').trim()
        if (item) items.push(item)
        current = ''
        continue
      }
      current += char
    }

    const last = cleanText(current).replace(/^[?붴뇯\s]+/, '').trim()
    if (last) items.push(last)
    return items
  }

  return text
    .split(/[,;/]+/)
    .map((item) => cleanText(item).replace(/^[↔⇔\s]+/, '').trim())
    .filter(Boolean)
}

function findColumn(headerRow: unknown[], key: HeaderKey) {
  const aliases = new Set(HEADER_ALIASES[key].map(normalizeHeader))
  return headerRow.findIndex((cell) => {
    const header = normalizeHeader(cell)
    if (aliases.has(header)) return true
    return PREFIX_MATCH_KEYS.has(key) && [...aliases].some((alias) => alias && header.startsWith(alias))
  })
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
      derivatives: cleanMultiline(cell(row, header.columns.derivatives)),
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
