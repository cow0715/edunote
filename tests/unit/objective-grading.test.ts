import { describe, expect, it } from 'vitest'
import { acceptedObjectiveAnswers, gradeObjective, resolveQuestionFlags } from '@/lib/objective-grading'

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

// ── 무효/전원정답 플래그 해석 ────────────────────────────────────────────────
//
// 문항 편집은 바뀐 플래그만 보낸다. 안 보낸 쪽이 false 로 떨어지면
// 다른 플래그가 조용히 풀려 학생 판정이 뒤집힌다 (운영 7번 문항이 이 상태였다).
describe('resolveQuestionFlags', () => {
  it('안 보낸 플래그는 DB 현재값을 유지한다', () => {
    const r = resolveQuestionFlags({ is_void: false }, { is_void: true, all_correct: true })
    expect(r).toEqual({ isVoid: false, allCorrect: true, verdict: 'all_correct' })
  })

  it('전원정답 문항의 무효만 해제해도 전원정답은 살아남는다', () => {
    // 이게 깨져서 all_correct=true 인데 학생 7명이 오답으로 찍혔다
    const r = resolveQuestionFlags({ is_void: false }, { is_void: true, all_correct: true })
    expect(r.verdict).not.toBe('regrade')
  })

  it('보낸 값이 DB 값을 이긴다', () => {
    expect(resolveQuestionFlags({ all_correct: false }, { all_correct: true }).allCorrect).toBe(false)
    expect(resolveQuestionFlags({ all_correct: true }, { all_correct: false }).allCorrect).toBe(true)
  })

  it('무효가 전원정답보다 우선이다 — 무효면 채점 대상이 아니다', () => {
    const r = resolveQuestionFlags({}, { is_void: true, all_correct: true })
    expect(r.verdict).toBe('void')
  })

  it('둘 다 아니면 정답키로 재채점한다', () => {
    expect(resolveQuestionFlags({}, {}).verdict).toBe('regrade')
    expect(resolveQuestionFlags({ is_void: false, all_correct: false }, { is_void: true, all_correct: true }).verdict).toBe('regrade')
  })

  it('DB 값이 null 이어도 false 로 다룬다', () => {
    const r = resolveQuestionFlags({}, { is_void: null, all_correct: null })
    expect(r).toEqual({ isVoid: false, allCorrect: false, verdict: 'regrade' })
  })
})
