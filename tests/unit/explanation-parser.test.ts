import { describe, expect, it } from 'vitest'
import { parseExplanationText } from '@/lib/explanation-parser'

// 해설 PDF는 출판사마다 헤더 표기가 달라서 회귀가 잦다.
// (반각 [] / 전각 【】 / 괄호 없는 형식 / 장문 묶음 헤더)

describe('parseExplanationText — 기본 반각 괄호 형식', () => {
  const text = [
    '18. [출제의도] 글의 목적 파악',
    '[해석] 이것은 해석입니다.',
    '[풀이] 이것은 풀이입니다.',
    '[Words and Phrases] apply 지원하다',
    '19. [출제의도] 심경 변화',
    '[해석] 두 번째 해석.',
  ].join('\n')
  const parsed = parseExplanationText(text)

  it('문항 경계마다 항목을 만든다', () => {
    expect(parsed.map((p) => p.question_number)).toEqual([18, 19])
  })

  it('출제의도를 뽑는다', () => {
    expect(parsed[0].intent).toBe('글의 목적 파악')
  })

  it('해석/풀이/어휘를 각 섹션으로 나눈다', () => {
    expect(parsed[0].translation).toBe('이것은 해석입니다.')
    expect(parsed[0].solution).toBe('이것은 풀이입니다.')
    expect(parsed[0].vocabulary).toBe('apply 지원하다')
  })

  it('없는 섹션은 빈 문자열', () => {
    expect(parsed[1].solution).toBe('')
    expect(parsed[1].vocabulary).toBe('')
  })
})

describe('parseExplanationText — 헤더 표기 변형', () => {
  it('전각 괄호 【출제의도】를 인식한다', () => {
    const parsed = parseExplanationText('20.【출제의도】 요지 파악\n【해석】 해석 내용.')
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ question_number: 20, intent: '요지 파악', translation: '해석 내용.' })
  })

  it('헤더 안에 공백이 있어도 인식한다 ([출제 의도])', () => {
    const parsed = parseExplanationText('21. [출제 의도] 함축 의미\n[해석] 해석.')
    expect(parsed[0].intent).toBe('함축 의미')
  })

  it('괄호 없는 형식의 문항 번호와 해석을 인식한다', () => {
    const parsed = parseExplanationText('22. 출제 의도 주제 파악 [해석] 해석 내용.')
    expect(parsed).toHaveLength(1)
    expect(parsed[0].question_number).toBe(22)
    expect(parsed[0].translation).toBe('해석 내용.')
  })

  // 괄호 없는 "출제 의도" 뒤에 반각 괄호 섹션([해석])이 오면
  // 예전에는 여는 대괄호까지 intent 에 딸려 들어왔다 ('주제 파악 [').
  it('다음 섹션이 괄호로 시작해도 출제의도만 깨끗하게 뽑는다', () => {
    expect(parseExplanationText('22. 출제 의도 주제 파악 [해석] 해석 내용.')[0].intent).toBe('주제 파악')
  })

  it('전각 괄호 섹션이 뒤따라도 마찬가지', () => {
    expect(parseExplanationText('23. 출제 의도 제목 추론 【해석】 해석 내용.')[0].intent).toBe('제목 추론')
  })

  it('빈 대괄호 형식은 그대로 유지된다', () => {
    expect(parseExplanationText('24. 출제 의도 어법 판단[ ] 해석 내용.')[0].intent).toBe('어법 판단')
  })

  it('출제의도 본문에 "해석" 같은 단어가 들어가도 잘려나가지 않는다', () => {
    expect(parseExplanationText('25. 출제 의도 해석 능력 평가 [풀이] 풀이 내용.')[0].intent).toBe('해석 능력 평가')
  })
})

describe('parseExplanationText — 문항 범위', () => {
  it('18번 미만(듣기)은 버린다', () => {
    const parsed = parseExplanationText('17. [출제의도] 듣기\n[해석] 듣기 해석.\n18. [출제의도] 목적\n[해석] 목적 해석.')
    expect(parsed.map((p) => p.question_number)).toEqual([18])
  })

  it('45번 초과는 버린다', () => {
    const parsed = parseExplanationText('45. [출제의도] 내용일치\n[해석] a.\n46. [출제의도] 없음\n[해석] b.')
    expect(parsed.map((p) => p.question_number)).toEqual([45])
  })

  it('경계가 하나도 없으면 빈 배열', () => {
    expect(parseExplanationText('아무 해설도 없는 텍스트')).toEqual([])
    expect(parseExplanationText('')).toEqual([])
  })
})

describe('parseExplanationText — 장문 묶음 (41~42])', () => {
  const parsed = parseExplanationText('41~42] [출제 의도] 장문 독해\n[해석] 공통 지문 해석.\n[풀이] 공통 풀이.')

  it('묶음 범위의 문항을 각각 만든다', () => {
    expect(parsed.map((p) => p.question_number)).toEqual([41, 42])
  })

  it('묶음 안의 문항은 같은 내용을 공유한다', () => {
    expect(parsed[0].translation).toBe('공통 지문 해석.')
    expect(parsed[1].translation).toBe('공통 지문 해석.')
    expect(parsed[1].solution).toBe('공통 풀이.')
  })
})

describe('parseExplanationText — 텍스트 정리', () => {
  it('줄바꿈과 중복 공백을 한 칸으로 줄인다', () => {
    const parsed = parseExplanationText('18. [출제의도] 목적\n[해석] 첫 줄\n   둘째 줄.')
    expect(parsed[0].translation).toBe('첫 줄 둘째 줄.')
  })

  it('어휘의 닫는 별표를 제거한다 (unpdf 이탤릭 변환 보정)', () => {
    const parsed = parseExplanationText('18. [출제의도] 목적\n[Words and Phrases] *pursue* 추구하다')
    expect(parsed[0].vocabulary).toBe('*pursue 추구하다')
  })
})
