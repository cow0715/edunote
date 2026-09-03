import { describe, it, expect, beforeAll } from 'vitest'

// client.ts 는 모듈 로드 시 Anthropic 클라이언트를 만들므로 env 를 먼저 채우고 동적 import 한다.
let parseJsonArrayResponse: <T>(raw: string, label?: string) => T[]
let parseJsonObjectResponse: <T>(raw: string, label?: string) => T
let extractJsonArrayCandidate: (raw: string) => string
let isJsonParseError: (error: unknown) => boolean

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY ||= 'test-key'
  const mod = await import('../../src/lib/llm/client')
  isJsonParseError = mod.isJsonParseError
  parseJsonArrayResponse = mod.parseJsonArrayResponse
  parseJsonObjectResponse = mod.parseJsonObjectResponse
  extractJsonArrayCandidate = mod.extractJsonArrayCandidate
})

describe('parseJsonArrayResponse', () => {
  it('```json 펜스를 벗기고 파싱한다', () => {
    const raw = '```json\n[{"a":1},{"a":2}]\n```'
    expect(parseJsonArrayResponse(raw)).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('배열 앞뒤의 잡담 텍스트를 잘라낸다', () => {
    const raw = '다음은 결과입니다:\n[{"a":1}]\n이상입니다.'
    expect(parseJsonArrayResponse(raw)).toEqual([{ a: 1 }])
  })

  it('후행 콤마 등 경미한 깨짐은 jsonrepair 로 복구한다', () => {
    const raw = '[{"a":1,},]'
    expect(parseJsonArrayResponse(raw)).toEqual([{ a: 1 }])
  })

  it('문자열 안 이스케이프 안 된 큰따옴표를 2차 복구로 살린다 (지문 속 대화)', () => {
    const raw = '[{"passage":"He said, "wait here" and left.","n":1}]'
    expect(parseJsonArrayResponse<{ passage: string; n: number }>(raw)).toEqual([
      { passage: 'He said, "wait here" and left.', n: 1 },
    ])
  })

  it('알려진 한계: JSON 이 아닌 잡담은 jsonrepair 가 문자열로 강제 변환한다 (문서화)', () => {
    // throw 대신 "..." 문자열이 나온다. 예전엔 그 문자열이 그대로 새어 나가 호출부가 배열 여부를
    // 따로 검증해야 했는데, 이제 비배열 결과는 배열로 감싸 반환 형태만은 항상 배열이다.
    expect(parseJsonArrayResponse('완전히 JSON 이 아닌 텍스트')).toEqual(['완전히 JSON 이 아닌 텍스트'])
  })
})

describe('parseJsonObjectResponse', () => {
  it('펜스와 앞뒤 텍스트를 제거하고 객체를 파싱한다', () => {
    const raw = '결과:\n```json\n{"name":"홍길동","ok":true}\n```'
    expect(parseJsonObjectResponse(raw)).toEqual({ name: '홍길동', ok: true })
  })

  it('객체 문자열 값 안의 미이스케이프 따옴표도 2차 복구한다', () => {
    const raw = '{"feedback":"the word "their" is wrong"}'
    expect(parseJsonObjectResponse<{ feedback: string }>(raw)).toEqual({
      feedback: 'the word "their" is wrong',
    })
  })
})

describe('extractJsonArrayCandidate', () => {
  it('주석 줄(//)을 제거한다', () => {
    const raw = '[\n// 주석\n{"a":1}\n]'
    expect(JSON.parse(extractJsonArrayCandidate(raw))).toEqual([{ a: 1 }])
  })
})

describe('isJsonParseError — 범위 콜 격리 재시도 트리거', () => {
  it('jsonrepair 실패 메시지를 잡는다 (실측: Unexpected character "f" at position 188)', () => {
    expect(isJsonParseError(new Error('Unexpected character "f" at position 188'))).toBe(true)
  })

  it('JSON.parse 의 SyntaxError 도 잡는다', () => {
    let err: unknown
    try { JSON.parse('{bad') } catch (e) { err = e }
    expect(isJsonParseError(err)).toBe(true)
  })

  it('네트워크·인증 에러는 아니다 — 이건 격리해도 소용없고 그대로 올려야 한다', () => {
    expect(isJsonParseError(new Error('Could not resolve authentication method'))).toBe(false)
    expect(isJsonParseError(new Error('429 rate limited'))).toBe(false)
    expect(isJsonParseError(new Error('Output blocked: filtered'))).toBe(false)
  })
})

describe('parseJsonArrayResponse — 바깥 [ ] 없이 객체만 온 응답', () => {
  it('객체 하나만 오면 배열로 감싼다', () => {
    const raw = '{"question_number":1,"sub_label":"a","correct_answer_text":"made"}'
    expect(parseJsonArrayResponse<{ question_number: number }>(raw)).toEqual([
      { question_number: 1, sub_label: 'a', correct_answer_text: 'made' },
    ])
  })

  it('지문 속 대괄호 "[ making / made ]" 가 있어도 배열 경계로 오인하지 않는다 (실측: position 188 실패)', () => {
    const raw = '{"question_number":1,"question_text":"(A) [ making / made ] 중 고르시오","correct_answer_text":"made"}'
    const out = parseJsonArrayResponse<{ question_number: number; question_text: string }>(raw)
    expect(out).toHaveLength(1)
    expect(out[0].question_text).toBe('(A) [ making / made ] 중 고르시오')
  })

  it('객체 여러 개가 쉼표로 이어져 오면 각각 항목이 된다', () => {
    const raw = '{"question_number":1,"sub_label":"a"},{"question_number":1,"sub_label":"b"}'
    expect(parseJsonArrayResponse<{ sub_label: string }>(raw).map((q) => q.sub_label)).toEqual(['a', 'b'])
  })

  it('객체 여러 개가 줄바꿈으로만 이어져도 jsonrepair 가 잇는다', () => {
    const raw = '{"question_number":1}\n{"question_number":2}'
    expect(parseJsonArrayResponse<{ question_number: number }>(raw).map((q) => q.question_number)).toEqual([1, 2])
  })

  it('정상 배열·코드펜스 응답은 그대로', () => {
    expect(extractJsonArrayCandidate('```json\n[{"a":1}]\n```')).toBe('[{"a":1}]')
    expect(parseJsonArrayResponse<{ a: number }>('설명 텍스트\n[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }])
  })
})
