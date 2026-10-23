import { parseJsonArrayResponse } from '../llm/json'
import type { PdfImportJob } from './types'
import type { ExamImportIssue } from './exam-completeness'

export type StoredExamQuestion = {
  question_number: number
  explanation_intent: string | null
  explanation_translation: string | null
  explanation_solution: string | null
  explanation_vocabulary: string | null
}
export type ExamCheckpointText = { task: string; text: string }
type Stage = ExamImportIssue['stage']
type Entry = Record<string, unknown>
const explanationFields = { intent: '출제 의도', translation: '해석', solution: '풀이', vocabulary: '어휘' } as const
const readingNumbers = Array.from({ length: 28 }, (_, i) => i + 18)
const hasText = (value: unknown) => typeof value === 'string' && !!value.trim()
const object = (value: unknown): Entry => value && typeof value === 'object' && !Array.isArray(value) ? value as Entry : {}

/** Reads only existing response JSON. It never reads a PDF or invokes a model. */
export function auditExamStorage(job: PdfImportJob, questions: StoredExamQuestion[], checkpoints: ExamCheckpointText[]) {
  const result = job.result ?? {}, saved = new Map(questions.map((q) => [q.question_number, q]))
  const parsed: Record<Stage, Map<number, Entry>> = { questions: new Map(), explanations: new Map() }
  const unreadable = new Set<Stage>()
  for (const checkpoint of checkpoints) {
    const stage: Stage = checkpoint.task === 'examBank.parseQuestions' ? 'questions' : 'explanations'
    try {
      for (const value of parseJsonArrayResponse<unknown>(checkpoint.text, 'exam-storage-audit')) {
        const entry = object(value), number = Number(entry.question_number)
        // Prewarm replies and inventory arrays are not parsed material results.
        const material = stage === 'questions' ? 'question_text' in entry : Object.keys(explanationFields).some((field) => field in entry)
        if (material && Number.isInteger(number) && number >= 18 && number <= 45) parsed[stage].set(number, entry)
      }
    } catch { unreadable.add(stage) }
  }
  const issues: ExamImportIssue[] = []
  const excluded = new Set((Array.isArray(result.excluded_questions) ? result.excluded_questions : []).map((v) => object(v).question_number))
  const add = (stage: Stage, number: number, reason: string, code: ExamImportIssue['code'] = 'missing') => {
    issues.push({ stage, question_number: number, code, reason, attempts: 0 })
  }
  if (job.kind === 'bank_questions') {
    for (const number of readingNumbers) if (!excluded.has(number) && !saved.has(number)) {
      add('questions', number, parsed.questions.has(number)
        ? '기존 처리 결과에는 문항이 있지만 현재 문제은행에 해당 번호가 저장되어 있지 않습니다.'
        : '독해 등록 대상(18~45번) 중 현재 문제은행에 해당 번호가 저장되어 있지 않습니다.')
    }
  }
  const explanationResult = job.kind === 'bank_explanation' ? result : object(result.explanation_result)
  const hasExplanationStage = job.kind === 'bank_explanation' || Object.keys(explanationResult).length > 0
  let checkError: string | undefined
  if (hasExplanationStage) {
    // Current saved numbers catch missing explanations; cached response numbers also
    // catch explanations silently skipped because their question did not exist.
    const expected = new Set([...saved.keys(), ...parsed.explanations.keys()].filter((n) => n >= 18 && n <= 45 && !excluded.has(n)))
    if (Number(explanationResult.total) === 28) readingNumbers.filter((n) => !excluded.has(n)).forEach((n) => expected.add(n))
    for (const number of expected) {
      const question = saved.get(number), entry = parsed.explanations.get(number)
      if (!question) {
        add('explanations', number, '현재 문제은행에 해당 번호의 문항이 없어 해설을 연결할 수 없습니다.', 'unmatched')
        continue
      }
      const missing = (Object.keys(explanationFields) as (keyof typeof explanationFields)[])
        .filter((field) => hasText(entry?.[field]) && !hasText(question[`explanation_${field}`]))
      if (missing.length) add('explanations', number, `기존 처리 결과의 ${missing.map((field) => explanationFields[field]).join('·')} 정보가 현재 문항에 저장되어 있지 않습니다.`)
      else if (!Object.keys(explanationFields).some((field) => hasText(question[`explanation_${field}` as keyof StoredExamQuestion]))) {
        add('explanations', number, '현재 문항에 저장된 해설 정보가 없습니다.')
      }
    }
    // A count discrepancy without a recoverable numbered response must never be
    // presented as completed. Do not guess which number failed or why it failed.
    if (Number(explanationResult.total) > expected.size + excluded.size || (unreadable.has('explanations') && !parsed.explanations.size)) {
      checkError = '기존 처리 수와 저장 문항 수가 일치하지 않지만, 남아 있는 처리 기록만으로 누락 번호를 확정할 수 없습니다.'
    }
  }
  return { ...job, result: { ...result, storage_issues: issues, storage_check_error: checkError ?? null } }
}
