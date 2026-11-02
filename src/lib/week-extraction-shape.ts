import { normalizeNewCorrectionKey } from './week-answer-contract'
import { normalizeFindErrorKeyText } from './find-error-grading'
import { z } from 'zod'
import type { ParsedAnswer } from './llm/week'

const identity = z.object({ question_number: z.number().int().positive(), sub_label: z.string().regex(/^[a-z]$/).nullable().default(null),
  question_style: z.enum(['objective', 'subjective', 'ox', 'multi_select', 'find_error']),
  source_section: z.enum(['general', 'written']).nullish().transform(v => v ?? undefined), source_question_number: z.number().int().positive().nullish().transform(v => v ?? undefined) })
const bbox = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine(b => b.x + b.width <= 1 && b.y + b.height <= 1)
const evidence = z.object({ file_index: z.number().int().positive(), page: z.number().int().positive(), quote: z.string().min(1) })

/** Validate model data before any .trim(), normalization or persistence. Identity
 * conflicts are retried; malformed optional content is flagged for source review. */
export function sanitizeWeekExtraction(value: unknown, validateNew = false): ParsedAnswer {
  const parsed = identity.safeParse(value)
  if (!parsed.success) throw new Error('문항 번호·소문항·답안 유형을 확인하지 못했습니다.')
  const raw = value as Record<string, unknown>
  const issues: string[] = []
  const text = (field: string) => {
    if (raw[field] != null && typeof raw[field] !== 'string') issues.push(`${field}: 원문 구조 확인 필요`)
    return typeof raw[field] === 'string' ? raw[field] : null
  }
  const candidate = typeof raw.correct_answer === 'string' && /^[0-5]$/.test(raw.correct_answer) ? Number(raw.correct_answer) : raw.correct_answer
  const key = typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0 && candidate <= 5 ? candidate : 0
  const proof = evidence.safeParse(raw.answer_evidence)
  const box = bbox.safeParse(raw.source_bbox)
  const answerText = text('correct_answer_text')
  const normalizedKey = parsed.data.question_style === 'find_error' ? (validateNew ? normalizeNewCorrectionKey(answerText) : normalizeFindErrorKeyText(answerText)) ?? answerText : answerText
  const symbol = normalizedKey?.match(/^([a-z]|[1-9][0-9]?):/i)?.[1].toLowerCase()
  const derivedLabel = symbol && /^[0-9]+$/.test(symbol) ? Number(symbol) <= 26 ? String.fromCharCode(96 + Number(symbol)) : null : symbol ?? null
  const subLabel = parsed.data.sub_label ?? (parsed.data.question_style === 'find_error' && raw.answer_status === 'found' && proof.success ? derivedLabel : null)
  return { ...parsed.data, sub_label: subLabel, question_type: text('question_type'), correct_answer: key, correct_answer_text: normalizedKey,
    grading_criteria: text('grading_criteria'), explanation: text('explanation'), question_text: text('question_text'),
    question_stem: text('question_stem'), passage: text('passage'), shared_passage: text('shared_passage'),
    choices: Array.isArray(raw.choices) && raw.choices.every(c => typeof c === 'string') ? raw.choices as string[] : null,
    needs_source_image: raw.needs_source_image === true, source_image_reason: text('source_image_reason'),
    source_page: typeof raw.source_page === 'number' && Number.isInteger(raw.source_page) && raw.source_page > 0 ? raw.source_page : null,
    source_bbox: box.success ? box.data : null,
    answer_status: ['found', 'missing', 'ambiguous'].includes(String(raw.answer_status)) ? raw.answer_status as ParsedAnswer['answer_status'] : 'missing',
    answer_evidence: proof.success ? proof.data : null, extraction_issues: issues }
}
