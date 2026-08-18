import { describe, expect, it } from 'vitest'
import { gradeOX, gradeMultiSelect } from '@/lib/grade-utils'

// gradeOX / gradeMultiSelect 는 4곳에서 호출된다:
//   api/weeks/[id]/grade, api/weeks/[id]/questions,
//   lib/week-reading-import (문제지 동기화 재채점 / 정답지 적용 재채점)
// 한 줄만 바뀌어도 네 경로의 채점 결과가 동시에 바뀐다.

describe('gradeOX — O 정답 문항', () => {
  it('정답이 O이고 학생이 O를 고르면 정답', () => {
    expect(gradeOX('O', 'O', '')).toBe(true)
  })

  it('정답이 O인데 학생이 X를 고르면 오답', () => {
    expect(gradeOX('O', 'X', 'was')).toBe(false)
  })

  it('정답이 O인데 학생이 아무것도 안 고르면 오답', () => {
    expect(gradeOX('O', null, '')).toBe(false)
  })

  it('정답 O는 소문자여도 인식한다', () => {
    expect(gradeOX('o', 'O', '')).toBe(true)
  })

  it('정답 O의 앞뒤 공백을 무시한다', () => {
    expect(gradeOX('  O  ', 'O', '')).toBe(true)
  })
})

describe('gradeOX — X 정답 문항 (수정어 입력)', () => {
  it('화살표 형식에서 화살표 뒤의 수정어만 정답으로 인정한다', () => {
    expect(gradeOX('X (were → was)', 'X', 'was')).toBe(true)
  })

  it('화살표 앞의 원래 단어를 쓰면 오답', () => {
    expect(gradeOX('X (were → was)', 'X', 'were')).toBe(false)
  })

  it('X 정답 문항에서 O를 고르면 수정어가 맞아도 오답', () => {
    expect(gradeOX('X (was)', 'O', 'was')).toBe(false)
  })

  it('수정어 대소문자를 무시한다', () => {
    expect(gradeOX('X (was)', 'X', 'WAS')).toBe(true)
  })

  it('수정어 앞뒤 공백을 무시한다', () => {
    expect(gradeOX('X (was)', 'X', '  was  ')).toBe(true)
  })

  it('괄호가 없으면 인정할 수정어가 없으므로 오답', () => {
    expect(gradeOX('X', 'X', 'was')).toBe(false)
  })
})

describe('gradeOX — / 복수정답', () => {
  const answer = 'X (in which / where)'

  it('첫 번째 대안을 인정한다', () => {
    expect(gradeOX(answer, 'X', 'in which')).toBe(true)
  })

  it('두 번째 대안을 인정한다', () => {
    expect(gradeOX(answer, 'X', 'where')).toBe(true)
  })

  it('대안 대소문자를 무시한다', () => {
    expect(gradeOX(answer, 'X', 'IN WHICH')).toBe(true)
  })

  it('목록에 없는 답은 오답', () => {
    expect(gradeOX(answer, 'X', 'that')).toBe(false)
  })

  it('빈 수정어는 오답', () => {
    expect(gradeOX(answer, 'X', '')).toBe(false)
  })
})

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
})
