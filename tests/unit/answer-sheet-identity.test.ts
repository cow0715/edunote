import { describe, expect, it } from 'vitest'
import { answerSheetCode, matchAnswerSheetCode } from '@/lib/answer-sheet-identity'
import { ANSWER_SHEET_TABLE_HEIGHT, paginateAnswerSheetRows } from '@/lib/answer-sheet-pagination'

describe('학생별 인쇄 코드', () => {
  const students = [{ studentId: 'a', name: '김학생' }, { studentId: 'b', name: '김학생' }, { studentId: 'c', name: '이학생' }]
  const code = answerSheetCode('week', 'a')

  it('같은 이름의 학생도 코드를 정확히 읽으면 구분한다', () => {
    expect(matchAnswerSheetCode('week', code.toLowerCase(), students, '김학생')).toEqual(students[0])
    expect(matchAnswerSheetCode('week', code, students, null)).toEqual(students[0])
  })

  it('다른 회차, 흐린 코드, 다른 재원생의 이름은 자동 연결하지 않는다', () => {
    expect(matchAnswerSheetCode('another-week', code, students, null)).toBeNull()
    expect(matchAnswerSheetCode('week', `${code.slice(0, -1)}?`, students, null)).toBeNull()
    expect(matchAnswerSheetCode('week', code, students, '이 학생')).toBeNull()
  })
})

it('문항 순서와 최소 답란 높이를 유지하면서 페이지 예산을 지킨다', () => {
  const rows = Array.from({ length: 19 }, (_, index) => ({ number: index + 1, minHeight: index === 7 ? 120 : 36, weight: 1 }))
  const pages = paginateAnswerSheetRows(rows)
  expect(pages).toHaveLength(2)
  expect(pages.flat().map((row) => row.number)).toEqual(rows.map((row) => row.number))
  for (const page of pages) {
    expect(page.length).toBeGreaterThan(1)
    expect(page.reduce((height, row) => height + row.heightPt, 0)).toBeLessThanOrEqual(ANSWER_SHEET_TABLE_HEIGHT)
    expect(page.every((row) => row.heightPt >= row.minHeight)).toBe(true)
  }
})
