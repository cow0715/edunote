/**
 * OX 문항 정오 판정 — 서버(grade·questions 라우트, 문제지 동기화)와 UI(채점지·채점 그리드·인쇄 답안지)가
 * 같은 규칙·같은 기호를 쓰도록 한 곳에 둔다. objective-grading.ts 와 같은 역할.
 *
 * 같은 question_style='ox' 라도 시험지가 두 가지 표기를 쓴다:
 *   OX = 어법 판단형. 정답키 "O" / "X (수정어)" — X 면 수정어까지 맞아야 정답.
 *   TF = 내용 참/거짓 판단형(Choose True or False). 정답키 "T" / "F" — 수정어 개념이 없다.
 * 표기법을 정답키에서 되읽는다. TF 를 O/X 로 정규화하지 않는 이유는 학생이 받은 시험지가
 * T/F 로 묻기 때문 — 인쇄 답안지·채점 버튼이 시험지와 같은 기호를 보여야 한다.
 */
export type OXNotation = 'OX' | 'TF'

export type OXAnswerKey = {
  notation: OXNotation
  /** 학생이 골라야 하는 쪽. TF 의 T 는 'O', F 는 'X' 로 맞춘다 (ox_selection 저장값과 같은 축) */
  verdict: 'O' | 'X'
  /** 인정하는 수정어 목록. 비어 있으면 수정어를 대조하지 않는다 */
  corrections: string[]
}

function parseCorrections(text: string): string[] {
  let value = /\((.+)\)/.exec(text)?.[1] ?? text
  value = value.trim().toLowerCase()
  if (!value) return []
  // "were → was" 는 화살표 뒤가 정답
  if (value.includes('→')) value = value.split('→').pop()?.trim() ?? value
  // '/' 구분자로 복수 정답 허용 (예: "in which / where")
  return value.split('/').map((s) => s.trim()).filter(Boolean)
}

/** 정답키 파싱. "O" / "X (were → was)" / "X → have" / "T" / "F" / "True" / "False" 를 받는다. */
export function parseOXAnswerKey(correctAnswerText: string | null | undefined): OXAnswerKey | null {
  const raw = (correctAnswerText ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return null

  const match = /^([^\s(:→]*)\s*[:→]?\s*(.*)$/.exec(raw)
  const token = match?.[1] ?? ''
  const rest = match?.[2] ?? ''

  if (/^o$/i.test(token)) return { notation: 'OX', verdict: 'O', corrections: [] }
  if (/^(?:t|true)$/i.test(token)) return { notation: 'TF', verdict: 'O', corrections: [] }
  if (/^(?:f|false)$/i.test(token)) return { notation: 'TF', verdict: 'X', corrections: [] }
  if (/^x$/i.test(token)) return { notation: 'OX', verdict: 'X', corrections: parseCorrections(rest) }

  // 판정 기호 없이 수정어만 적힌 구형 키 — X 로 보고 수정어를 살린다
  const corrections = parseCorrections(raw)
  return corrections.length > 0 ? { notation: 'OX', verdict: 'X', corrections } : null
}

/** 정답키가 쓰는 표기법. 못 읽으면 기존 기본값인 O/X. */
export function oxNotation(correctAnswerText: string | null | undefined): OXNotation {
  return parseOXAnswerKey(correctAnswerText)?.notation ?? 'OX'
}

/** 소문항이 한 행에 묶인 경우의 표기법 — 하나라도 T/F 면 그 행 전체를 T/F 로 인쇄한다 */
export function oxNotationForGroup(correctAnswerTexts: (string | null | undefined)[]): OXNotation {
  return correctAnswerTexts.some((text) => oxNotation(text) === 'TF') ? 'TF' : 'OX'
}

/** 표기법에 맞는 버튼·인쇄 기호 (yes = 맞음, no = 틀림) */
export function oxChoiceLabels(notation: OXNotation): { yes: string; no: string } {
  return notation === 'TF' ? { yes: 'T', no: 'F' } : { yes: 'O', no: 'X' }
}

/** 채점 UI 한 칸("O" / "X" / "X 수정어" / "T" / "F") → 저장 형태로 분리 */
export function parseOXStudentInput(text: string | null | undefined): {
  oxSelection: 'O' | 'X' | null
  correction: string | null
} {
  const raw = (text ?? '').trim()
  if (!raw) return { oxSelection: null, correction: null }

  const upper = raw.toUpperCase()
  if (upper === 'O' || upper === 'T') return { oxSelection: 'O', correction: null }
  if (upper === 'X' || upper === 'F') return { oxSelection: 'X', correction: null }

  const withCorrection = /^[XF][\s:→]+(.*)$/i.exec(raw)
  if (withCorrection) return { oxSelection: 'X', correction: withCorrection[1].trim() || null }

  // 구형 포맷 — 수정어만 저장된 경우
  return { oxSelection: 'X', correction: raw }
}

/** 저장 형태 → 채점 UI 한 칸. parseOXStudentInput 의 역방향. */
export function formatOXStudentInput(
  oxSelection: string | null | undefined,
  correction: string | null | undefined,
  notation: OXNotation = 'OX',
): string {
  const { yes, no } = oxChoiceLabels(notation)
  if (oxSelection === 'O') return yes
  if (oxSelection !== 'X') return ''
  if (notation === 'TF') return no
  const trimmed = (correction ?? '').trim()
  return trimmed ? `X ${trimmed}` : 'X'
}

// oxSelection: 'O' | 'X' | null, correctionText: 수정어만 (X 접두사 없음)
export function gradeOX(correctAnswerText: string, oxSelection: string | null, correctionText: string): boolean {
  const key = parseOXAnswerKey(correctAnswerText)
  if (!key) return false
  if (key.verdict === 'O') return oxSelection === 'O'
  if (oxSelection !== 'X') return false
  // T/F 판단형은 수정어를 묻지 않는다 — F 를 고른 것만으로 정답
  if (key.notation === 'TF') return true
  const student = correctionText.trim().toLowerCase()
  return key.corrections.some((alt) => student === alt)
}
