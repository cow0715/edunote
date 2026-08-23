import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseVocabRows, parseVocabWorkbookBuffer } from '@/lib/vocab-xlsx'
import { buildRuleBasedVariants } from '@/lib/vocab-variants'

// scripts/test-vocab-xlsx.ts 에서 이관 + 신규 워크북 포맷 케이스 추가.

const BASE_ROWS = [
  ['지문', '본문 단어', '품사', '본문 의미', '문맥 동의어', '파생어 / 변형 주의', '반의어'],
  ['20.', '', '', '', '', '', ''],
  ['20', 'surprise', 'v.', '놀라게 하다', 'astonish, amaze', 'surprising (a.) / surprised (a.)', ''],
  ['20', 'convenience', 'n.', '편리함', 'ease / accessibility', 'convenient (a.) / conveniently (ad.)', '↔ inconvenience'],
  ['21.', '', '', '', '', '', ''],
  ['21', 'amount', 'n.', '양', 'quantity, volume', '—', '—'],
]

describe('parseVocabRows — 기본 포맷', () => {
  const parsed = parseVocabRows(BASE_ROWS)

  it('단어 행만 골라낸다 (지문 구분 행 제외)', () => {
    expect(parsed).toHaveLength(3)
    expect(parsed.map((w) => w.english_word)).toEqual(['surprise', 'convenience', 'amount'])
  })

  it('번호를 1부터 다시 매긴다', () => {
    expect(parsed.map((w) => w.number)).toEqual([1, 2, 3])
  })

  it('지문 라벨의 마침표를 떼고 붙인다', () => {
    expect(parsed.map((w) => w.passage_label)).toEqual(['20', '20', '21'])
  })

  it('동의어를 쉼표/슬래시로 분리한다', () => {
    expect(parsed[0].synonyms).toEqual(['astonish', 'amaze'])
    expect(parsed[1].synonyms).toEqual(['ease', 'accessibility'])
  })

  it('반의어의 ↔ 기호를 제거한다', () => {
    expect(parsed[1].antonyms).toEqual(['inconvenience'])
  })

  it('— 같은 빈 표기는 null/빈 배열로 처리한다', () => {
    expect(parsed[2].derivatives).toBeNull()
    expect(parsed[2].antonyms).toEqual([])
  })

  it('원본 행 번호를 1-based로 남긴다', () => {
    expect(parsed[0].source_row_index).toBe(3)
  })

  it('뜻과 품사를 그대로 가져온다', () => {
    expect(parsed[0]).toMatchObject({ part_of_speech: 'v.', correct_answer: '놀라게 하다' })
  })
})

describe('parseVocabRows — 헤더 변형', () => {
  it('"문맥 동의어 (+뜻)" 처럼 접미가 붙은 헤더도 인식한다', () => {
    const rows = [
      ['지문', '본문 단어', '품사', '반의어', '본문 의미', '문맥 동의어 (+뜻)', '파생어 / 변형 주의'],
      ['고2 210629', 'carry out', '', 'abandon / cancel', '수행하다, 실시하다', 'conduct(수행하다, 실시하다), perform(실행하다)', '—'],
    ]
    const [entry] = parseVocabRows(rows)
    expect(entry.english_word).toBe('carry out')
    expect(entry.antonyms).toEqual(['abandon', 'cancel'])
  })

  it('헤더 순서가 바뀌어도 컬럼을 찾아낸다', () => {
    const rows = [
      ['본문 의미', '본문 단어'],
      ['사과', 'apple'],
    ]
    const [entry] = parseVocabRows(rows)
    expect(entry).toMatchObject({ english_word: 'apple', correct_answer: '사과' })
  })

  it('헤더 위에 제목 행이 있어도 찾아낸다', () => {
    const rows = [
      ['2026년 1학기 단어장', '', ''],
      [],
      ['본문 단어', '본문 의미'],
      ['apple', '사과'],
    ]
    expect(parseVocabRows(rows)).toHaveLength(1)
  })

  it('필수 헤더가 없으면 에러를 던진다', () => {
    expect(() => parseVocabRows([['a', 'b'], ['c', 'd']])).toThrow(/헤더/)
  })
})

describe('parseVocabRows — 지문 라벨 이어받기', () => {
  it('지문 칸이 비면 직전 구분 행의 라벨을 물려받는다', () => {
    const rows = [
      ['지문', '본문 단어', '본문 의미'],
      ['31.', '', ''],
      ['', 'alpha', '알파'],
      ['', 'beta', '베타'],
    ]
    expect(parseVocabRows(rows).map((w) => w.passage_label)).toEqual(['31', '31'])
  })
})

describe('parseVocabWorkbookBuffer', () => {
  it('단어장 형식이 아닌 시트는 건너뛰고 맞는 시트를 찾는다', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['not', 'a', 'vocab', 'sheet']]), 'Sheet1')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(BASE_ROWS), '시험대비 단어장')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const parsed = parseVocabWorkbookBuffer(buffer)
    expect(parsed).toHaveLength(3)
    expect(parsed[0].english_word).toBe('surprise')
  })

  it('맞는 시트가 하나도 없으면 에러를 던진다', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['a', 'b']]), 'Sheet1')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    expect(() => parseVocabWorkbookBuffer(buffer)).toThrow(/단어장 형식/)
  })
})

describe('buildRuleBasedVariants', () => {
  it('동의어 괄호 안의 뜻을 각각 분리해서 가져온다', () => {
    const rows = [
      ['지문', '본문 단어', '품사', '반의어', '본문 의미', '문맥 동의어 (+뜻)', '파생어 / 변형 주의'],
      ['고2 210629', 'carry out', '', 'abandon / cancel', '수행하다, 실시하다', 'conduct(수행하다, 실시하다), perform(실행하다)', '—'],
    ]
    const [entry] = parseVocabRows(rows)
    const synonyms = buildRuleBasedVariants(entry).filter((v) => v.relation_type === 'synonym')

    expect(synonyms.map((v) => [v.word, v.meaning])).toEqual([
      ['conduct', '수행하다, 실시하다'],
      ['perform', '실행하다'],
    ])
  })

  it('원본 단어를 original 관계로 포함한다', () => {
    const [entry] = parseVocabRows(BASE_ROWS.slice(0, 1).concat([['20', 'surprise', 'v.', '놀라게 하다', '', '', '']]))
    const original = buildRuleBasedVariants(entry).find((v) => v.relation_type === 'original')
    expect(original).toMatchObject({ word: 'surprise', meaning: '놀라게 하다' })
  })

  it('파생어와 반의어를 각 관계로 분리한다', () => {
    const [entry] = parseVocabRows(BASE_ROWS.slice(0, 1).concat([BASE_ROWS[3]]))
    const variants = buildRuleBasedVariants(entry)
    expect(variants.filter((v) => v.relation_type === 'derivative').map((v) => v.word)).toContain('convenient')
    expect(variants.filter((v) => v.relation_type === 'antonym').map((v) => v.word)).toContain('inconvenience')
  })

  it('반의어 variant 도 출제 가능(exam_enabled) 상태로 만든다', () => {
    // 과거엔 반의어만 false 로 저장해 반의어 문항이 한 번도 출제되지 않던 회귀 방지
    const [entry] = parseVocabRows(BASE_ROWS.slice(0, 1).concat([BASE_ROWS[3]]))
    const variants = buildRuleBasedVariants(entry)
    expect(variants.length).toBeGreaterThan(0)
    expect(variants.every((v) => v.exam_enabled === true)).toBe(true)
  })
})
