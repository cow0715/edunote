// LLM 파싱 결과를 저장 직전에 한 가지 형태(canonical form)로 맞춘다.
//
// 프롬프트가 아무리 정확해도 출력은 흔들린다 — 선지에 기호가 붙었다 말았다 하고,
// 빈 값이 undefined/null/[]/"" 로 제각각이고, multi_select 정답이 "①,③" 로 오기도 한다.
// 읽는 쪽(오답노트·채점·다시풀기)이 각자 관용을 두면 같은 데이터가 화면마다 다르게 읽힌다.
// 그래서 쓰기 전에 한 번만 정리한다. 여기 있는 함수는 전부 순수 함수다.
//
// 규약 (컬럼 기준):
//   choices             string[] | null  — 기호 없이 내용만, 2개 미만이면 null
//   question_stem 등    string | null    — 공백만 있으면 null
//   correct_answer      number           — objective 만 1~N, 나머지는 0
//   correct_answer_text ox: "O" | "X (수정어)" | "T" | "F" (공백 정리만)
//                       multi_select: "1,3" / "a,c,f" (기호→숫자·소문자, 쉼표 구분)
//                       find_error: "기호:수정어" (normalizeFindErrorKeyText 가 담당)

import type { ParsedAnswer } from '@/lib/llm/week'
import { splitStoredQuestionText } from '@/lib/question-structure'

const CIRCLED_DIGITS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
const CIRCLED_LETTERS = ['ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ', 'ⓕ', 'ⓖ', 'ⓗ', 'ⓘ', 'ⓙ']

/**
 * "① 감사" / "1. 감사" / "1) 감사" → "감사". 기호가 없으면 그대로.
 * "①" 처럼 기호뿐이면 기호를 남긴다 — 문장 삽입 위치처럼 고를 대상이 지문 안에 있어
 * 선지 텍스트가 없는 유형이다. 벗겨서 빈 문자열로 만들면 선지 자체가 사라진다.
 */
export function stripChoiceMarker(value: string): string {
  const trimmed = value.trim()
  const bare = trimmed.match(/^\(?\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*\)?$/)
  if (bare) return bare[1]
  return trimmed.replace(/^(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/, '').trim()
}

/**
 * 선지 배열 정리. 배열이 아니거나 남는 게 2개 미만이면 null —
 * 선지 하나는 선지가 아니고, [] 와 null 이 같은 뜻으로 두 가지 값이면 소비자가 둘 다 검사해야 한다.
 */
export function normalizeChoices(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const cleaned = value
    .map((item) => (typeof item === 'string' ? stripChoiceMarker(item) : ''))
    .filter(Boolean)
  return cleaned.length >= 2 ? cleaned : null
}

/** 공백뿐인 문자열은 null 로 — "" 와 null 이 같은 뜻으로 공존하지 않게 */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * multi_select 정답키: "①,③" / "1, 3" / "(b), (d)" / "A,C" → "1,3" / "b,d" / "a,c".
 * 채점(gradeMultiSelect)은 어떤 표기든 받아주지만, 저장값이 통일돼야 화면·통계에서
 * 같은 정답이 같은 문자열로 보인다. 순서는 원문 그대로 두고 중복만 뺀다.
 */
export function normalizeMultiSelectKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const tokens = value
    .split(/[,、/\s]+/)
    .map((raw) => {
      const token = raw.trim().replace(/^\(|\)$/g, '')
      if (!token) return ''
      const digitIndex = CIRCLED_DIGITS.indexOf(token)
      if (digitIndex >= 0) return String(digitIndex + 1)
      const letterIndex = CIRCLED_LETTERS.indexOf(token)
      if (letterIndex >= 0) return String.fromCharCode(97 + letterIndex)
      return token.toLowerCase()
    })
    .filter(Boolean)
  const unique = tokens.filter((token, index) => tokens.indexOf(token) === index)
  return unique.length ? unique.join(',') : null
}

/** OX 정답키는 형태를 바꾸지 않는다 (파서가 여러 표기를 받아준다). 공백만 정리 */
export function normalizeOXKey(value: unknown): string | null {
  const text = normalizeText(value)
  return text ? text.replace(/\s+/g, ' ') : null
}

/**
 * 조각(발문/지문/선지)이 비었을 때 통짜 question_text 에서 분해를 시도한다.
 *
 * 읽는 쪽이 이미 같은 폴백(getStructuredQuestionParts → splitStoredQuestionText)을 쓴다.
 * 쓰기 시점으로 옮기면 "구조화된 행" 이 항상 구조화돼 있어 소비자가 폴백을 들고 다닐 필요가 없다.
 *
 * 단, 빈 줄로 나뉜 구조가 실제로 있을 때만 받는다. 해설지형 question_text 는 줄바꿈 하나로
 * 이어지는 경우가 많아 분해하면 발문 자리에 전문이 통째로 들어간다 — 그럴 땐 null 을 유지한다.
 */
export function deriveStructureFromQuestionText(
  questionText: string | null | undefined,
): { question_stem: string; passage: string | null; choices: string[] | null } | null {
  if (!questionText?.trim()) return null
  const { questionStem, passage, choices } = splitStoredQuestionText(questionText)
  const stem = questionStem.trim()
  const body = passage.trim()
  const normalizedChoices = normalizeChoices(choices)
  if (!stem) return null
  // 발문 하나만 나왔다 = 구조가 없다. 지문이나 선지 중 하나는 분리돼야 분해로 인정한다
  if (!body && !normalizedChoices) return null
  return { question_stem: stem, passage: body || null, choices: normalizedChoices }
}

/**
 * ParsedAnswer 한 건을 canonical form 으로. 번호·소문항·find_error 정규화는
 * week-reading-import.normalizeParsedAnswers 가 먼저 하고, 여기서는 형태만 맞춘다.
 */
export function normalizeParsedAnswerShape(answer: ParsedAnswer): ParsedAnswer {
  const style = answer.question_style
  const isObjective = style === 'objective'

  let questionStem = normalizeText(answer.question_stem)
  let passage = normalizeText(answer.passage)
  // 선지는 객관식·multi_select 에만 있다. 서술형·OX·find_error 에 모델이 후보(ⓐ~ⓔ 등)를
  // 선지처럼 실어 보내는 런이 있는데, 그대로 두면 다시풀기·조립기가 선지로 오인한다.
  const canHaveChoices = style === 'objective' || style === 'multi_select'
  let choices = canHaveChoices ? normalizeChoices(answer.choices) : null

  // 조각이 통째로 비어 있으면 통짜에서 분해를 시도한다 (구조가 실제로 있을 때만)
  if (!questionStem && !passage) {
    const derived = deriveStructureFromQuestionText(answer.question_text)
    if (derived) {
      questionStem = derived.question_stem
      passage = derived.passage
      if (!choices && canHaveChoices) choices = derived.choices
    }
  }

  let correctAnswerText: string | null
  switch (style) {
    case 'multi_select':
      correctAnswerText = normalizeMultiSelectKey(answer.correct_answer_text)
      break
    case 'ox':
      correctAnswerText = normalizeOXKey(answer.correct_answer_text)
      break
    default:
      correctAnswerText = normalizeText(answer.correct_answer_text)
  }

  return {
    ...answer,
    // 정답 번호는 objective 만 의미가 있다. 다른 유형에 남은 숫자는 파서 잔재라 0 으로 통일
    correct_answer: isObjective ? answer.correct_answer : 0,
    correct_answer_text: correctAnswerText,
    explanation: normalizeText(answer.explanation),
    grading_criteria: normalizeText(answer.grading_criteria),
    question_text: normalizeText(answer.question_text),
    question_stem: questionStem,
    passage,
    choices,
  }
}
