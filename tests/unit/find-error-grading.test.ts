import { describe, expect, it } from 'vitest'
import {
  assignFindErrorAnswers, gradeFindErrorRow, normalizeCorrection,
  normalizeErrorSymbol, normalizeFindErrorKeyText, parseFindErrorKey, parseFindErrorStudentAnswer,
} from '@/lib/find-error-grading'

// 아래 "운영 실사례" 케이스들은 2026-08 운영 DB 에서 실제로 잘못 채점됐던 답안들이다.
// AI 통짜 채점이 콜론 뒤 공백·기호 표기 차이로 정오를 뒤집던 것을 코드 판정으로 고정한다.

describe('normalizeErrorSymbol', () => {
  it('원문자·괄호·대문자를 정규화한다', () => {
    expect(normalizeErrorSymbol('④')).toBe('4')
    expect(normalizeErrorSymbol('ⓒ')).toBe('c')
    expect(normalizeErrorSymbol('(b)')).toBe('b')
    expect(normalizeErrorSymbol('B')).toBe('b')
    expect(normalizeErrorSymbol('3')).toBe('3')
  })

  it('기호가 아니면 null', () => {
    expect(normalizeErrorSymbol('was')).toBeNull()
    expect(normalizeErrorSymbol('')).toBeNull()
    expect(normalizeErrorSymbol('f')).toBeNull() // 보기 기호는 a~e 까지만
  })
})

describe('parseFindErrorKey', () => {
  it('규격 "기호:수정어" 를 파싱한다', () => {
    expect(parseFindErrorKey('4:satisfied')).toEqual({ symbol: '4', correction: 'satisfied' })
    expect(parseFindErrorKey('b:Rarely did the workers have time to relax'))
      .toEqual({ symbol: 'b', correction: 'Rarely did the workers have time to relax' })
  })

  it('이탈 형식 "틀린단어:고친단어" 도 고친 표현은 살린다 (운영 실사례 different:similar)', () => {
    expect(parseFindErrorKey('different:similar')).toEqual({ symbol: null, correction: 'similar' })
  })

  it('화살표가 섞이면 뒤쪽이 고친 표현', () => {
    expect(parseFindErrorKey('c:ask → asked')).toEqual({ symbol: 'c', correction: 'asked' })
  })

  it('빈 값은 null', () => {
    expect(parseFindErrorKey(null)).toBeNull()
    expect(parseFindErrorKey('  ')).toBeNull()
  })
})

describe('normalizeFindErrorKeyText — 파싱 저장 정규형', () => {
  it('원문자·공백 변형을 규격으로 고친다', () => {
    expect(normalizeFindErrorKeyText('④: were ')).toBe('4:were')
    // 콜론 없는 이탈 형식(파싱 프롬프트의 ❌ 예시)도 규격으로 복원한다
    expect(normalizeFindErrorKeyText('ⓒ ask → asked')).toBe('c:asked')
  })
})

describe('parseFindErrorStudentAnswer', () => {
  it('콜론 뒤 공백 변형을 흡수한다 (운영 실사례: "4: satisfied" 가 오답 처리됐었다)', () => {
    expect(parseFindErrorStudentAnswer('4: satisfied')).toEqual({ symbol: '4', correction: 'satisfied' })
    expect(parseFindErrorStudentAnswer('4:satisfied')).toEqual({ symbol: '4', correction: 'satisfied' })
    expect(parseFindErrorStudentAnswer(' 5:themselves')).toEqual({ symbol: '5', correction: 'themselves' })
  })

  it('원문자·괄호 기호를 읽는다', () => {
    expect(parseFindErrorStudentAnswer('④ were')).toEqual({ symbol: '4', correction: 'were' })
    expect(parseFindErrorStudentAnswer('③ whose → who')).toEqual({ symbol: '3', correction: 'who' })
    expect(parseFindErrorStudentAnswer('(b) was')).toEqual({ symbol: 'b', correction: 'was' })
  })

  it('선행 X 마커와 화살표를 처리한다 (운영 실사례: "X satisfying → satisfied")', () => {
    expect(parseFindErrorStudentAnswer('X satisfying → satisfied')).toEqual({ symbol: null, correction: 'satisfied' })
    expect(parseFindErrorStudentAnswer('satisfying → satisfied')).toEqual({ symbol: null, correction: 'satisfied' })
    expect(parseFindErrorStudentAnswer('X them → themselves')).toEqual({ symbol: null, correction: 'themselves' })
  })

  it('기호가 떨어져 나가고 콜론만 남은 OCR 형태 (운영 실사례: ":Rarely did ...")', () => {
    expect(parseFindErrorStudentAnswer(':Rarely did the workers had time to relax'))
      .toEqual({ symbol: null, correction: 'Rarely did the workers had time to relax' })
  })

  it('한 글자 알파벳 + 공백은 기호로 보지 않는다 ("a lot" 의 a)', () => {
    expect(parseFindErrorStudentAnswer('a lot')).toEqual({ symbol: null, correction: 'a lot' })
  })

  it('알파벳 기호는 구분자가 있어야 인정한다', () => {
    expect(parseFindErrorStudentAnswer('b: was')).toEqual({ symbol: 'b', correction: 'was' })
    expect(parseFindErrorStudentAnswer('b) was')).toEqual({ symbol: 'b', correction: 'was' })
  })

  it('빈 답', () => {
    expect(parseFindErrorStudentAnswer('')).toEqual({ symbol: null, correction: '' })
    expect(parseFindErrorStudentAnswer(null)).toEqual({ symbol: null, correction: '' })
  })
})

describe('normalizeCorrection', () => {
  it('대소문자·공백·끝 구두점을 흡수한다', () => {
    expect(normalizeCorrection('Not once have they complained about the difficult task.'))
      .toBe(normalizeCorrection('not once  have they complained about the difficult task'))
  })
})

describe('gradeFindErrorRow — 행 단위 재채점', () => {
  const key = ['4:satisfied']

  it('기호+표현 일치 → 정답 (공백 변형 포함)', () => {
    expect(gradeFindErrorRow(key, '4:satisfied')).toBe('correct')
    expect(gradeFindErrorRow(key, '4: satisfied')).toBe('correct')
    expect(gradeFindErrorRow(key, '④ satisfied')).toBe('correct')
  })

  it('기호 없이 표현만 일치해도 정답 (기호 없으면 의미 매칭 규칙)', () => {
    expect(gradeFindErrorRow(key, 'satisfying → satisfied')).toBe('correct')
    expect(gradeFindErrorRow(key, 'X satisfying → satisfied')).toBe('correct')
  })

  it('기호가 정답 기호와 다르면 확정 오답 (운영 실사례: ③ whose → who vs 4:were)', () => {
    expect(gradeFindErrorRow(['4:were'], '③ whose → who')).toBe('wrong')
  })

  it('기호만 쓰고 수정이 없으면 오답', () => {
    expect(gradeFindErrorRow(key, '4')).toBe('wrong')
    expect(gradeFindErrorRow(key, '④')).toBe('wrong')
  })

  it('기호는 맞고 표현이 다르면 AI 로 (의미 비교 필요)', () => {
    expect(gradeFindErrorRow(key, '4: I was satisfied with it')).toBe('ai')
  })

  it('기호 없는 정답키(different:similar)는 기호 오답 판정을 하지 않는다', () => {
    expect(gradeFindErrorRow(['different:similar'], 'X similar')).toBe('correct')
    expect(gradeFindErrorRow(['different:similar'], 'X different to similar')).toBe('ai')
  })

  it('빈 답은 오답', () => {
    expect(gradeFindErrorRow(key, '')).toBe('wrong')
    expect(gradeFindErrorRow(key, null)).toBe('wrong')
  })

  it('문장 전체 정답키 — 마침표만 다른 답은 정답 (운영 실사례: 윤인섭·심동빈이 오답 처리됐었다)', () => {
    const sentenceKey = ['d:Not once have they complained about the difficult task']
    expect(gradeFindErrorRow(sentenceKey, 'Not once have they complained about the difficult task.')).toBe('correct')
  })
})

describe('assignFindErrorAnswers — 문항 단위 집합 매칭', () => {
  const keyRows = [
    { id: 'row-b', correctAnswerText: 'b:Rarely did the workers have time to relax' },
    { id: 'row-d', correctAnswerText: 'd:Not once have they complained about the difficult task' },
  ]

  it('기호가 맞는 답을 해당 행으로 배정한다 (슬롯 순서와 무관)', () => {
    const result = assignFindErrorAnswers(keyRows, [
      'd: Not once have they complained about the difficult task',
      'b: Rarely did the workers have time to relax',
    ])
    expect(result).toEqual([
      { id: 'row-b', text: 'b: Rarely did the workers have time to relax', verdict: 'correct' },
      { id: 'row-d', text: 'd: Not once have they complained about the difficult task', verdict: 'correct' },
    ])
  })

  it('기호 없는 답은 표현으로 매칭한다 (마침표 차이 포함)', () => {
    const result = assignFindErrorAnswers(keyRows, [
      'Rarely did the workers have time to relax.',
      'Not once have they complained about the difficult task.',
    ])
    expect(result.map((r) => r.verdict)).toEqual(['correct', 'correct'])
  })

  it('기호는 맞지만 표현이 틀리면 AI 로 넘긴다', () => {
    const result = assignFindErrorAnswers(keyRows, [
      'b: Rarely did the workers had time to relax', // had — 오타/오답 가능
      '',
    ])
    expect(result[0].verdict).toBe('ai')
    expect(result[1]).toEqual({ id: 'row-d', text: '', verdict: 'wrong' }) // 미입력
  })

  it('정답 기호에 없는 기호를 쓰면 확정 오답', () => {
    const result = assignFindErrorAnswers(keyRows, ['a: some wrong sentence', ''])
    expect(result[0].verdict).toBe('wrong')
    expect(result[0].text).toBe('a: some wrong sentence')
  })

  it('행보다 답이 많으면 마지막 행에 이어 붙인다 (조용히 버리지 않음)', () => {
    const single = [{ id: 'only', correctAnswerText: '4:satisfied' }]
    const result = assignFindErrorAnswers(single, ['4:satisfied'])
    expect(result[0].verdict).toBe('correct')
  })

  it('단일 행 문항도 같은 규칙으로 (운영 실사례 용산고 6~8번)', () => {
    const single = [{ id: 'q6', correctAnswerText: '4:satisfied' }]
    expect(assignFindErrorAnswers(single, ['4: satisfied'])[0].verdict).toBe('correct')
    expect(assignFindErrorAnswers(single, ['4:satisfied'])[0].verdict).toBe('correct')
    expect(assignFindErrorAnswers(single, ['X satisfying → satisfied'])[0].verdict).toBe('correct')
    expect(assignFindErrorAnswers(single, ['satisfying → satisfied'])[0].verdict).toBe('correct')
    expect(assignFindErrorAnswers(single, ['③ whose → who'])[0].verdict).toBe('wrong')
  })
})
