import { describe, expect, it } from 'vitest'
import {
  formatOXStudentInput, gradeOX, oxChoiceLabels, oxNotation, oxNotationForGroup,
  parseOXAnswerKey, parseOXStudentInput,
} from '@/lib/ox-grading'

// gradeOX 는 4곳에서 호출된다:
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

  it('괄호 없이 화살표로만 적힌 정답키도 수정어를 읽는다', () => {
    expect(gradeOX('X → have', 'X', 'have')).toBe(true)
    expect(gradeOX('X → have', 'X', 'has')).toBe(false)
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

// 운영 회귀: 용산고 26주차 1번은 "Choose True or False (T/F)" 문항이라
// 정답키가 T/F 로 저장됐는데, O/X 만 알던 규칙이 답한 13건을 전부 오답으로 기록했다.
describe('gradeOX — T/F 내용 판단형', () => {
  it('정답 T에 O(참)를 고르면 정답', () => {
    expect(gradeOX('T', 'O', '')).toBe(true)
  })

  it('정답 T에 X(거짓)를 고르면 오답', () => {
    expect(gradeOX('T', 'X', '')).toBe(false)
  })

  it('정답 F에 X(거짓)를 고르면 수정어 없이도 정답', () => {
    expect(gradeOX('F', 'X', '')).toBe(true)
  })

  it('정답 F에 O(참)를 고르면 오답', () => {
    expect(gradeOX('F', 'O', '')).toBe(false)
  })

  it('T/F 문항은 수정어를 대조하지 않는다', () => {
    expect(gradeOX('F', 'X', '아무거나')).toBe(true)
  })

  it('미응답은 오답', () => {
    expect(gradeOX('T', null, '')).toBe(false)
    expect(gradeOX('F', null, '')).toBe(false)
  })

  it('True/False 전체 표기와 소문자도 인식한다', () => {
    expect(gradeOX('True', 'O', '')).toBe(true)
    expect(gradeOX('false', 'X', '')).toBe(true)
    expect(gradeOX('TRUE', 'X', '')).toBe(false)
  })

  it('용산고 26주차 1번 (a~e) 실제 정답키·학생 선택', () => {
    const keys = ['T', 'F', 'T', 'F', 'F']
    const picked = ['O', 'X', 'O', 'X', 'X'] // 학생이 T·F·T·F·F 로 답한 것
    expect(keys.map((key, i) => gradeOX(key, picked[i], ''))).toEqual([true, true, true, true, true])
  })
})

describe('gradeOX — 읽을 수 없는 정답키', () => {
  it('빈 정답키는 오답', () => {
    expect(gradeOX('', 'O', '')).toBe(false)
    expect(gradeOX('   ', 'X', 'was')).toBe(false)
  })

  it('판정 기호 없이 수정어만 적힌 구형 키는 X + 수정어로 본다', () => {
    expect(gradeOX('(their)', 'X', 'their')).toBe(true)
    expect(gradeOX('(their)', 'O', 'their')).toBe(false)
  })
})

describe('parseOXAnswerKey / oxNotation', () => {
  it('O·X 키는 OX 표기법', () => {
    expect(parseOXAnswerKey('O')).toEqual({ notation: 'OX', verdict: 'O', corrections: [] })
    expect(parseOXAnswerKey('X (was)')).toEqual({ notation: 'OX', verdict: 'X', corrections: ['was'] })
  })

  it('T·F 키는 TF 표기법이고 수정어를 갖지 않는다', () => {
    expect(parseOXAnswerKey('T')).toEqual({ notation: 'TF', verdict: 'O', corrections: [] })
    expect(parseOXAnswerKey('F')).toEqual({ notation: 'TF', verdict: 'X', corrections: [] })
  })

  it('빈 값은 null', () => {
    expect(parseOXAnswerKey(null)).toBeNull()
    expect(parseOXAnswerKey('')).toBeNull()
  })

  it('표기법을 못 읽으면 기존 기본값 OX', () => {
    expect(oxNotation(null)).toBe('OX')
    expect(oxNotation('O')).toBe('OX')
    expect(oxNotation('F')).toBe('TF')
  })

  it('소문항 한 행은 하나라도 T/F 면 T/F 로 인쇄한다', () => {
    expect(oxNotationForGroup(['T', 'F', 'T'])).toBe('TF')
    expect(oxNotationForGroup(['O', 'X (was)'])).toBe('OX')
    expect(oxNotationForGroup([])).toBe('OX')
  })

  it('표기법별 인쇄 기호', () => {
    expect(oxChoiceLabels('OX')).toEqual({ yes: 'O', no: 'X' })
    expect(oxChoiceLabels('TF')).toEqual({ yes: 'T', no: 'F' })
  })
})

describe('parseOXStudentInput', () => {
  it('빈 입력은 미응답', () => {
    expect(parseOXStudentInput('')).toEqual({ oxSelection: null, correction: null })
    expect(parseOXStudentInput(null)).toEqual({ oxSelection: null, correction: null })
  })

  it('O / X 를 그대로 읽는다', () => {
    expect(parseOXStudentInput('O')).toEqual({ oxSelection: 'O', correction: null })
    expect(parseOXStudentInput('X')).toEqual({ oxSelection: 'X', correction: null })
  })

  it('T 는 O 쪽, F 는 X 쪽으로 맞춘다', () => {
    expect(parseOXStudentInput('T')).toEqual({ oxSelection: 'O', correction: null })
    expect(parseOXStudentInput('f')).toEqual({ oxSelection: 'X', correction: null })
  })

  it('"X 수정어" 형식에서 수정어만 분리한다', () => {
    expect(parseOXStudentInput('X was')).toEqual({ oxSelection: 'X', correction: 'was' })
    expect(parseOXStudentInput('X → was')).toEqual({ oxSelection: 'X', correction: 'was' })
  })

  it('수정어만 저장된 구형 포맷은 X 로 본다', () => {
    expect(parseOXStudentInput('was')).toEqual({ oxSelection: 'X', correction: 'was' })
  })
})

describe('formatOXStudentInput — parseOXStudentInput 역방향', () => {
  it('OX 표기법은 수정어를 붙여 복원한다', () => {
    expect(formatOXStudentInput('O', null, 'OX')).toBe('O')
    expect(formatOXStudentInput('X', null, 'OX')).toBe('X')
    expect(formatOXStudentInput('X', 'was', 'OX')).toBe('X was')
  })

  it('TF 표기법은 T/F 로 복원하고 수정어를 버린다', () => {
    expect(formatOXStudentInput('O', null, 'TF')).toBe('T')
    expect(formatOXStudentInput('X', 'was', 'TF')).toBe('F')
  })

  it('미응답은 빈 문자열', () => {
    expect(formatOXStudentInput(null, null, 'TF')).toBe('')
    expect(formatOXStudentInput(null, null, 'OX')).toBe('')
  })

  it('왕복해도 값이 유지된다', () => {
    const cases = [['O', 'OX'], ['X was', 'OX'], ['X', 'OX'], ['T', 'TF'], ['F', 'TF']] as const
    for (const [text, notation] of cases) {
      const { oxSelection, correction } = parseOXStudentInput(text)
      expect(formatOXStudentInput(oxSelection, correction, notation)).toBe(text)
    }
  })
})
