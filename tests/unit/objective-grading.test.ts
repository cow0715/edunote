import { describe, expect, it } from 'vitest'
import { acceptedObjectiveAnswers, gradeObjective } from '@/lib/objective-grading'

// 서버(채점 저장)와 UI(정오표)가 같은 규칙으로 객관식을 판정해야 한다.

describe('acceptedObjectiveAnswers', () => {
  it('정답 + 복수정답을 합친다', () => {
    expect([...acceptedObjectiveAnswers({ correct_answer: 3, extra_correct_answers: [5] })]).toEqual([3, 5])
  })

  it('0 이하·중복은 버린다 (정답키 없음 = 빈 집합)', () => {
    expect(acceptedObjectiveAnswers({ correct_answer: 0 }).size).toBe(0)
    expect(acceptedObjectiveAnswers({ correct_answer: null, extra_correct_answers: [0, -1] }).size).toBe(0)
    expect([...acceptedObjectiveAnswers({ correct_answer: 2, extra_correct_answers: [2] })]).toEqual([2])
  })
})

describe('gradeObjective', () => {
  it('미입력이면 undefined', () => {
    expect(gradeObjective({ correct_answer: 3 }, null)).toBeUndefined()
    expect(gradeObjective({ correct_answer: 3 }, undefined)).toBeUndefined()
  })

  it('정답·오답', () => {
    expect(gradeObjective({ correct_answer: 3 }, 3)).toBe(true)
    expect(gradeObjective({ correct_answer: 3 }, 1)).toBe(false)
  })

  it('복수정답은 어느 쪽을 골라도 정답 (예전 채점 저장은 첫 정답만 인정하던 버그)', () => {
    const q = { correct_answer: 3, extra_correct_answers: [5] }
    expect(gradeObjective(q, 5)).toBe(true)
    expect(gradeObjective(q, 4)).toBe(false)
  })

  it('전원정답 문항은 답만 있으면 정답', () => {
    expect(gradeObjective({ correct_answer: 3, all_correct: true }, 1)).toBe(true)
    expect(gradeObjective({ correct_answer: 3, all_correct: true }, null)).toBeUndefined()
  })

  it('정답키가 없으면(0) 뭘 골라도 오답 취급 — 정답 입력 전 저장 케이스', () => {
    expect(gradeObjective({ correct_answer: 0 }, 2)).toBe(false)
  })
})
