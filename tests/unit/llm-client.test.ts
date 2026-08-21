import { describe, it, expect, beforeAll } from 'vitest'

// client.ts 는 모듈 로드 시 Anthropic 클라이언트를 만들므로 env 를 먼저 채우고 동적 import 한다.
let parseJsonArrayResponse: <T>(raw: string, label?: string) => T[]
let parseJsonObjectResponse: <T>(raw: string, label?: string) => T
let extractJsonArrayCandidate: (raw: string) => string

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY ||= 'test-key'
  const mod = await import('../../src/lib/llm/client')
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
    // throw 대신 "..." 문자열이 나온다 — 호출부가 배열 여부를 따로 검증해야 하는 이유.
    expect(parseJsonArrayResponse('완전히 JSON 이 아닌 텍스트')).toBe('완전히 JSON 이 아닌 텍스트')
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
