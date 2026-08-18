import { describe, expect, it } from 'vitest'
import { gradeBlankAnswer, gradeChoiceAnswer, isWithinOneEdit } from '@/lib/vocab-blank-grading'

describe('gradeChoiceAnswer', () => {
  it('표시한 후보가 정답이면 정답', () => {
    expect(gradeChoiceAnswer('includes', 'includes')).toBe(true)
    expect(gradeChoiceAnswer(' Includes ', 'includes')).toBe(true)
  })

  it('오답 후보를 골랐으면 오답', () => {
    expect(gradeChoiceAnswer('exclude', 'includes')).toBe(false)
  })

  it('관용 없음 (후보 철자 그대로)', () => {
    expect(gradeChoiceAnswer('include', 'includes')).toBe(false)
  })

  it('미기재는 오답', () => {
    expect(gradeChoiceAnswer('', 'includes')).toBe(false)
    expect(gradeChoiceAnswer(null, 'includes')).toBe(false)
  })
})

describe('isWithinOneEdit', () => {
  it('같으면 true', () => {
    expect(isWithinOneEdit('abandon', 'abandon')).toBe(true)
  })
  it('치환 1', () => {
    expect(isWithinOneEdit('abandom', 'abandon')).toBe(true)
  })
  it('누락/추가 1', () => {
    expect(isWithinOneEdit('abandn', 'abandon')).toBe(true)
    expect(isWithinOneEdit('abanddon', 'abandon')).toBe(true)
  })
  it('인접 전치 1', () => {
    expect(isWithinOneEdit('abadnon', 'abandon')).toBe(true)
  })
  it('편집거리 2는 false', () => {
    expect(isWithinOneEdit('abondom', 'abandon')).toBe(false)
    expect(isWithinOneEdit('abandon', 'abandoned')).toBe(false)
  })
})

describe('gradeBlankAnswer', () => {
  it('정확히 같으면 정답', () => {
    expect(gradeBlankAnswer('abandoned', 'abandoned')).toBe(true)
  })

  it('대소문자·공백·구두점은 무시한다', () => {
    expect(gradeBlankAnswer('  Abandoned. ', 'abandoned')).toBe(true)
  })

  it('어형이 다르면 오답 (원형·다른 굴절형)', () => {
    expect(gradeBlankAnswer('abandon', 'abandoned')).toBe(false)
    expect(gradeBlankAnswer('abandons', 'abandoned')).toBe(false)
    expect(gradeBlankAnswer('abandoned', 'abandon')).toBe(false)
    expect(gradeBlankAnswer('make', 'making')).toBe(false)
  })

  it('철자 한 글자 오차는 정답 (치환/누락/추가/전치)', () => {
    expect(gradeBlankAnswer('abandomed', 'abandoned')).toBe(true)
    expect(gradeBlankAnswer('abandned', 'abandoned')).toBe(true)
    expect(gradeBlankAnswer('abanddoned', 'abandoned')).toBe(true)
    expect(gradeBlankAnswer('abadnoned', 'abandoned')).toBe(true)
  })

  it('자음 중복 단어의 한 글자 누락도 오타로 관용 (suppresed → suppressed)', () => {
    // 가짜 원형(suppres)에서 만든 suppresed 가 sibling 으로 잡혀 오답 처리되던 실제 버그
    expect(gradeBlankAnswer('suppresed', 'suppressed')).toBe(true)
    expect(gradeBlankAnswer('stoped', 'stopped')).toBe(true)
    expect(gradeBlankAnswer('planed', 'planned')).toBe(true)
  })

  it('철자 두 글자 이상 오차는 오답', () => {
    expect(gradeBlankAnswer('abondomed', 'abandoned')).toBe(false)
  })

  it('오타가 다른 굴절형과 같아지면 어형 오류로 오답', () => {
    // includes ↔ included: 편집거리 1이지만 서로 다른 어형
    expect(gradeBlankAnswer('includes', 'included')).toBe(false)
    // making ↔ makes 는 거리 2라 애초에 오답, made ↔ make 는 거리 1이지만 다른 어형
    expect(gradeBlankAnswer('make', 'made')).toBe(false)
  })

  it('짧은 단어(4자 이하)는 관용 없음', () => {
    expect(gradeBlankAnswer('lik', 'like')).toBe(false)
    expect(gradeBlankAnswer('liek', 'like')).toBe(false)
  })

  it('구(phrase)는 토큰별 비교, 어형은 엄격', () => {
    expect(gradeBlankAnswer('gives up', 'gives up')).toBe(true)
    expect(gradeBlankAnswer('give up', 'gives up')).toBe(false)
    expect(gradeBlankAnswer('give in', 'give up')).toBe(false)
  })

  it('빈 답·null 은 오답', () => {
    expect(gradeBlankAnswer('', 'abandon')).toBe(false)
    expect(gradeBlankAnswer(null, 'abandon')).toBe(false)
    expect(gradeBlankAnswer('abandon', null)).toBe(false)
  })
})
