import { describe, expect, it } from 'vitest'
import { checkAnswerSheetPages } from '@/lib/answer-sheet-page-check'
import { buildAnswerSheetPages } from '@/lib/answer-sheet-layout'

const photo = (sheetPage?: number, b64 = String(sheetPage)) => ({ mimeType: 'image/jpeg', b64, sheetPage })

describe('인쇄 양면 답안지 쪽수 검사', () => {
  const questions = Array.from({ length: 20 }, (_, index) => ({
    question_number: index + 1, sub_label: null, question_style: 'objective', correct_answer_text: null,
  }))
  const expected = buildAnswerSheetPages(questions).pages.length

  it('인쇄 페이지 수를 사용하여 섞인 앞뒷장과 완전한 PDF를 통과시킨다', () => {
    expect(expected).toBe(2)
    expect(checkAnswerSheetPages([photo(2), photo(1)], expected)).toEqual([])
    expect(checkAnswerSheetPages([{ ...photo(1), mimeType: 'application/pdf', pageCount: 2, sheetPages: [1, 2] }], expected)).toEqual([])
  })

  it('빠진 쪽과 같은 면의 재촬영을 구분한다', () => {
    expect(checkAnswerSheetPages([photo(1)], expected)).toEqual(['2쪽 누락'])
    expect(checkAnswerSheetPages([photo(1), photo(1, 'new photo')], expected)).toEqual(['2쪽 누락', '1쪽 중복'])
    expect(checkAnswerSheetPages([{ ...photo(1), mimeType: 'application/pdf', pageCount: 2, sheetPages: [1, 1] }], expected)).toEqual(['2쪽 누락', '1쪽 중복'])
  })

  it('쪽수를 읽지 못하면 누락 여부를 단정하지 않고 확인을 요청한다', () => {
    expect(checkAnswerSheetPages([photo(1), photo()], expected)).toEqual(['1쪽의 인쇄 쪽수 확인 필요'])
    expect(checkAnswerSheetPages([photo()], expected)).toEqual(['최소 1쪽 누락', '1쪽의 인쇄 쪽수 확인 필요'])
    expect(checkAnswerSheetPages([photo(), photo()], expected)).toEqual(['같은 파일 중복', '2쪽의 인쇄 쪽수 확인 필요'])
    expect(checkAnswerSheetPages([photo()], 1)).toEqual([])
  })
})
