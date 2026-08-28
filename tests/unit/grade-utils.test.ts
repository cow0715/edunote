import { describe, expect, it } from 'vitest'
import { gradeMultiSelect } from '@/lib/grade-utils'

// OX 판정 테스트는 @/lib/ox-grading 로 옮겼다 (tests/unit/ox-grading.test.ts).
describe('gradeMultiSelect', () => {
  it('선택 순서가 달라도 정답', () => {
    expect(gradeMultiSelect('a,b,c', 'c,b,a')).toBe(true)
  })

  it('구분자 주변 공백을 무시한다', () => {
    expect(gradeMultiSelect('a, b', 'b,a')).toBe(true)
  })

  it('대소문자를 무시한다', () => {
    expect(gradeMultiSelect('A,B', 'a,b')).toBe(true)
  })

  it('빈 항목을 무시한다', () => {
    expect(gradeMultiSelect('a,,b', 'b,a')).toBe(true)
  })

  it('일부만 고르면 오답', () => {
    expect(gradeMultiSelect('a,b', 'a')).toBe(false)
  })

  it('더 많이 고르면 오답', () => {
    expect(gradeMultiSelect('a,b', 'a,b,c')).toBe(false)
  })

  it('양쪽 모두 비어있으면 정답으로 본다', () => {
    expect(gradeMultiSelect('', '')).toBe(true)
  })

  // 운영에 알파벳 보기 문항(정답키 "a,b,e")이 실존 — 표기가 달라도 같은 선택이면 정답
  it('원문자·괄호·대문자 표기를 정답키와 맞춘다', () => {
    expect(gradeMultiSelect('a,b,e', 'ⓐ,ⓑ,ⓔ')).toBe(true)
    expect(gradeMultiSelect('a,b,e', 'A, B, E')).toBe(true)
    expect(gradeMultiSelect('a,b,e', '(a),(b),(e)')).toBe(true)
    expect(gradeMultiSelect('1,3', '①,③')).toBe(true)
    expect(gradeMultiSelect('a,b,e', 'a,b')).toBe(false)
  })
})
