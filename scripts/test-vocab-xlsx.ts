import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseVocabRows, parseVocabWorkbookBuffer } from '../src/lib/vocab-xlsx'

const rows = [
  ['지문', '본문 단어', '품사', '본문 의미', '문맥 동의어', '파생어 / 변형 주의', '반의어'],
  ['20.', '', '', '', '', '', ''],
  ['20', 'surprise', 'v.', '놀라게 하다', 'astonish, amaze', 'surprising (a.) / surprised (a.)', ''],
  ['20', 'convenience', 'n.', '편리함', 'ease / accessibility', 'convenient (a.) / conveniently (ad.)', '↔ inconvenience'],
  ['21.', '', '', '', '', '', ''],
  ['21', 'amount', 'n.', '양', 'quantity, volume', '—', '—'],
]

const parsedRows = parseVocabRows(rows)
assert.equal(parsedRows.length, 3)
assert.deepEqual(parsedRows.map((w) => w.number), [1, 2, 3])
assert.deepEqual(parsedRows.map((w) => w.passage_label), ['20', '20', '21'])
assert.deepEqual(parsedRows[0].synonyms, ['astonish', 'amaze'])
assert.deepEqual(parsedRows[1].synonyms, ['ease', 'accessibility'])
assert.deepEqual(parsedRows[1].antonyms, ['inconvenience'])
assert.equal(parsedRows[2].derivatives, null)
assert.deepEqual(parsedRows[2].antonyms, [])
assert.equal(parsedRows[0].source_row_index, 3)

const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['not', 'a', 'vocab', 'sheet']]), 'Sheet1')
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '시험대비 단어장')
const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
const parsedWorkbook = parseVocabWorkbookBuffer(buffer)
assert.equal(parsedWorkbook.length, 3)
assert.equal(parsedWorkbook[0].english_word, 'surprise')

console.log('vocab-xlsx parser tests passed')
