export type ExamImportIssue = {
  stage: 'questions' | 'explanations'
  question_number: number
  code: 'missing' | 'invalid_json' | 'invalid_fields' | 'refusal' | 'truncated' | 'request_failed' | 'unmatched'
  reason: string
  attempts: number
}

export type ExamImportExclusion = { question_number: number; reason: string }

/** Also recognizes older job results, which only recorded skipped numbers. */
export function examImportIssues(result: Record<string, unknown> | null): ExamImportIssue[] {
  if (!result) return []
  const issues: ExamImportIssue[] = []
  function collect(value: Record<string, unknown>, stage: ExamImportIssue['stage']) {
    const details = Array.isArray(value.issues) ? value.issues as ExamImportIssue[] : []
    issues.push(...details)
    const skipped = value.skipped_questions ?? value.skipped_pages
    if (Array.isArray(skipped)) for (const number of skipped) {
      if (Number.isInteger(number) && !details.some((issue) => issue.question_number === number)) {
        issues.push({ stage, question_number: number, code: 'missing', reason: '기존 처리 기록에 인식하지 못한 문항으로 남아 있습니다.', attempts: 0 })
      }
    }
    if (value.explanation_result && typeof value.explanation_result === 'object') {
      collect(value.explanation_result as Record<string, unknown>, 'explanations')
    }
  }
  collect(result, typeof result.mode === 'string' ? 'explanations' : 'questions')
  return issues.sort((a, b) => a.question_number - b.question_number || a.stage.localeCompare(b.stage))
}

export function examRecoveryBlocked(job: { kind: string; result: Record<string, unknown> | null }) {
  return ['bank_questions', 'bank_explanation'].includes(job.kind) && job.result?.exam_incomplete === true
}
