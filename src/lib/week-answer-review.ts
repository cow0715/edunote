import { z } from 'zod'
import type { ParsedAnswer } from './llm/week'

export type AnswerEvidence = { file_index: number; page: number; quote: string }
export type ReviewSource = { role: 'combined' | 'questions' | 'answers'; fileName: string; bucket: string; path: string; sha256: string; pageCount: number }
export type ReviewAnswer = ParsedAnswer & { answer_evidence?: AnswerEvidence | null; answer_status?: string; evidence_verified: boolean; review_reasons: string[] }
export type ExistingAnswerKey = Omit<Pick<ParsedAnswer, 'question_number' | 'sub_label' | 'question_style' | 'correct_answer' | 'correct_answer_text' | 'source_section' | 'source_question_number'>, 'correct_answer'> & { id: string; correct_answer: number | null }
export type AnswerDraft = { id: string; status: 'review' | 'confirmed'; sources: ReviewSource[]; answers: ReviewAnswer[]; base_questions: ExistingAnswerKey[]; created_at: string; reviewed_answers?: (Omit<ReviewAnswer, 'correct_answer'> & { correct_answer: number | null })[] | null }
export const ANSWER_KEY_COLUMNS = 'id,question_number,sub_label,question_style,correct_answer,correct_answer_text,source_section,source_question_number'
const compact = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const marks = ['①', '②', '③', '④', '⑤']
export const answerKey = (q: { question_number: number; sub_label: string | null }) => `${q.question_number}:${q.sub_label ?? ''}`

/** A model's claim is not evidence. Match its quote to the nominated original page
 * and require a printed answer context, never a choice in the question body. */
export function verifyAnswerEvidence(answer: ParsedAnswer, pages: string[][], sources: Pick<ReviewSource, 'role'>[]): boolean {
  const e = answer.answer_evidence
  if (answer.answer_status !== 'found' || !e || !Number.isInteger(e.file_index) || !Number.isInteger(e.page) || !e.quote?.trim()) return false
  const text = pages[e.file_index - 1]?.[e.page - 1]
  if (!text || !compact(text).includes(compact(e.quote))) return false
  const answerSection = pages[e.file_index - 1].slice(0, e.page).some(page => /(?:^|\n)\s*(?:정답\s*(?:및|과|·|&)?\s*해설|정답표|해답|answer\s*key)\s*(?:\n|$)/i.test(page))
  const tableNumbers = new Set([...text.matchAll(/(?:번\s*\[?\s*(\d+)\s*\]?|\[?\s*(\d+)\s*\]?\s*(?:번|[.)]))\s*[:：]?\s*[①②③④⑤]/g)].map(m => Number(m[1] ?? m[2])))
  const answerTable = tableNumbers.size >= 3 && tableNumbers.has(answer.source_question_number ?? answer.question_number)
  const explicitExplanationPage = /[\[{]\s*(?:정답|해답|해설|풀이|해석)\s*[\]}]|(?:정답|해답|해설|풀이|해석)\s*\[\s*\]/.test(text)
  if (sources[e.file_index - 1]?.role !== 'answers' && !answerSection && !explicitExplanationPage && !answerTable && !/(?:정답|해답|answer\s*key|correct\s*answer|\[답\])/i.test(e.quote)) return false
  if (answer.question_style === 'objective') {
    const n = answer.correct_answer
    if (!Number.isInteger(n) || n < 1 || n > 5) return false
    const circled = [...new Set(e.quote.match(/[①②③④⑤]/g) ?? [])]
    if (circled.length) return circled.length === 1 && circled[0] === marks[n - 1]
    // The parent number is not an answer token (e.g. '1. 정답 2').
    const parent = answer.source_question_number ?? answer.question_number
    const withoutHeading = e.quote.replace(new RegExp(`^\\s*(?:서답형\\s*|서술형\\s*)?${parent}(?:번|[.)]|(?=\\s))\\s*`), '')
    const tokens = withoutHeading.match(/(?<![0-9])[1-5](?![0-9])/g) ?? []
    return tokens.length === 1 && Number(tokens[0]) === n
  }
  const key = answer.correct_answer_text?.trim()
  if (!key) return false
  if (answer.question_style === 'multi_select') {
    const expected = key.toLowerCase().split(/[,，]/).map(v => v.trim()).sort()
    const circled = e.quote.match(/[①-⑳ⓐ-ⓩ]/gi) ?? []
    const printed = circled.length ? circled.map(v => v.normalize('NFKC').toLowerCase())
      : e.quote.match(/(?<![a-z0-9])[1-5a-z](?:\s*[,，]\s*[1-5a-z])+(?![a-z0-9])/i)?.[0].split(/[,，]/).map(v => v.trim().toLowerCase()) ?? []
    return JSON.stringify([...new Set(printed)].sort()) === JSON.stringify([...new Set(expected)])
  }
  if (answer.question_style === 'find_error') {
    const symbol = key.match(/^([a-z]|[1-9][0-9]?)\s*:/i)?.[1].toLowerCase()
    if (!symbol) return false
    const n = /^[a-z]$/.test(symbol) ? symbol.charCodeAt(0) - 96 : Number(symbol)
    const letter = n >= 1 && n <= 26 ? String.fromCharCode(96 + n) : ''
    const hasSymbol = (n >= 1 && n <= 20 && e.quote.includes(String.fromCodePoint(0x2460 + n - 1))) ||
      (letter && (e.quote.includes(String.fromCodePoint(0x24d0 + n - 1)) || new RegExp(`(^|[^a-z])${letter}([^a-z]|$)`, 'i').test(e.quote)))
    if (!hasSymbol) return false
  }
  // find_error's normalized "b:asked" is represented by its correction in the original.
  const expression = answer.question_style === 'find_error' ? key.replace(/^[a-z0-9]+\s*:\s*/i, '') : key
  return compact(e.quote).replace(/[，,]/g, '').includes(compact(expression).replace(/[，,]/g, ''))
}

export function prepareAnswerReview(answers: ParsedAnswer[], pages: string[][], sources: Pick<ReviewSource, 'role'>[]): ReviewAnswer[] {
  return answers.map(answer => {
    const verified = verifyAnswerEvidence(answer, pages, sources)
    return { ...answer, correct_answer: verified ? answer.correct_answer : 0,
      correct_answer_text: verified ? answer.correct_answer_text : null,
      // Unsupported generated solutions must not masquerade as the source explanation.
      explanation: verified ? answer.explanation : null,
      grading_criteria: verified ? answer.grading_criteria : null,
      evidence_verified: verified, review_reasons: [...(answer.extraction_issues ?? []), ...(verified ? [] : ['원문 정답 근거를 확인하지 못했습니다. 원문을 확인하고 정답을 직접 입력해 주세요.'])] }
  })
}

export const reviewActionSchema = z.object({
  index: z.number().int().nonnegative(), reviewed: z.literal(true), keep_existing: z.boolean().optional(),
  manual: z.boolean().optional(), question_style: z.enum(['objective', 'subjective', 'ox', 'multi_select', 'find_error']).optional(),
  sub_label: z.string().regex(/^[a-z]$/).nullable().optional(),
  correct_answer: z.number().int().min(0).max(5).optional(), correct_answer_text: z.string().max(20000).nullable().optional(),
})
export type ReviewAction = z.infer<typeof reviewActionSchema>

/** Client edits are limited to reviewed answer fields; PDF content and identities
 * come from the stored draft. Existing exams may only confirm the SAME key set. */
export function resolveAnswerReview(draft: Pick<AnswerDraft, 'answers' | 'base_questions'>, input: unknown) {
  const actions = z.array(reviewActionSchema).parse(input)
  if (actions.length !== draft.answers.length || new Set(actions.map(a => a.index)).size !== actions.length) throw new Error('모든 문항을 한 번씩 검토해 주세요.')
  const existing = new Map(draft.base_questions.map(q => [answerKey(q), q]))
  const reviewed = draft.answers.map((candidate, index) => {
    const action = actions.find(a => a.index === index)
    if (!action) throw new Error('검토하지 않은 문항이 있습니다.')
    const sub_label = action.sub_label === undefined ? candidate.sub_label : action.sub_label
    const previous = existing.get(answerKey({ ...candidate, sub_label }))
    if (action.keep_existing && !previous) throw new Error('보존할 기존 정답이 없습니다.')
    if (!action.keep_existing && !candidate.evidence_verified && action.manual !== true) throw new Error('근거 없는 정답은 직접 확인·입력해야 합니다.')
    if (!action.keep_existing && action.manual !== true && ((action.question_style !== undefined && action.question_style !== candidate.question_style) || (action.sub_label !== undefined && action.sub_label !== candidate.sub_label) || (action.correct_answer !== undefined && action.correct_answer !== candidate.correct_answer) || (action.correct_answer_text !== undefined && action.correct_answer_text !== candidate.correct_answer_text))) throw new Error('수정한 정답은 직접 검토해야 합니다.')
    const chosen = action.keep_existing ? previous! : { ...candidate,
      question_style: action.question_style ?? candidate.question_style, sub_label,
      correct_answer: action.correct_answer ?? candidate.correct_answer,
      correct_answer_text: action.correct_answer_text === undefined ? candidate.correct_answer_text : action.correct_answer_text }
    if (chosen.question_style === 'objective' ? !((chosen.correct_answer ?? 0) >= 1 && (chosen.correct_answer ?? 0) <= 5) : !chosen.correct_answer_text?.trim()) throw new Error(`${candidate.question_number}번 정답을 입력해 주세요.`)
    if (chosen.question_style === 'find_error' && !/^[a-z0-9]+\s*:\s*\S/i.test(chosen.correct_answer_text ?? '')) throw new Error('오류교정 정답은 기호:수정어 형식으로 입력해 주세요.')
    if (previous && (chosen.question_style !== previous.question_style || (chosen.question_style === 'objective' && chosen.correct_answer !== previous.correct_answer) || chosen.correct_answer_text !== previous.correct_answer_text)) throw new Error('기존 정답은 변경할 수 없습니다. 기존 정답 유지를 선택해 주세요.')
    return { ...candidate, sub_label: chosen.sub_label, question_style: chosen.question_style,
      correct_answer: previous ? previous.correct_answer : chosen.question_style === 'objective' ? chosen.correct_answer : 0,
      correct_answer_text: chosen.question_style === 'objective' ? null : chosen.correct_answer_text,
      reviewed: true, answer_origin: previous ? 'existing' : action.manual ? 'teacher' : 'source' }
  })
  if (new Set(reviewed.map(answerKey)).size !== reviewed.length) throw new Error('문항 번호·소문항이 중복됐습니다.')
  if (existing.size && (reviewed.length !== existing.size || reviewed.some(q => !existing.has(answerKey(q))))) throw new Error('기존 시험의 문항 구성은 보존해야 합니다. 다른 시험은 새 주차에 등록해 주세요.')
  return reviewed
}
