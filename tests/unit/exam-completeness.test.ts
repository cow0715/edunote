import { describe, expect, it } from 'vitest'
import { examImportIssues, examRecoveryBlocked } from '@/lib/pdf-import/exam-completeness'

describe('exam completeness reporting', () => {
  it('merges both PDF stages without losing or duplicating skipped numbers', () => {
    const issues = examImportIssues({ skipped_pages: [22], issues: [{ stage: 'questions', question_number: 22, code: 'missing', reason: '번호 없음', attempts: 3 }],
      explanation_result: { skipped_questions: [31], issues: [{ stage: 'explanations', question_number: 31, code: 'refusal', reason: '거절', attempts: 3 }] } })
    expect(issues.map((issue) => [issue.stage, issue.question_number, issue.reason])).toEqual([['questions', 22, '번호 없음'], ['explanations', 31, '거절']])
  })
  it('does not turn explicit chart exclusions into failures and reads old explanation records', () => {
    expect(examImportIssues({ excluded_questions: [{ question_number: 25, reason: '도표 제외' }] })).toEqual([])
    expect(examImportIssues({ mode: 'standard', skipped_questions: [42] })).toMatchObject([{ stage: 'explanations', question_number: 42, attempts: 0 }])
  })
  it('only blocks exhausted exam recovery, leaving weekly and textbook recovery untouched', () => {
    expect(examRecoveryBlocked({ kind: 'bank_explanation', result: { exam_incomplete: true } })).toBe(true)
    expect(examRecoveryBlocked({ kind: 'week_answers', result: { exam_incomplete: true } })).toBe(false)
    expect(examRecoveryBlocked({ kind: 'bank_book', result: { exam_incomplete: true } })).toBe(false)
    expect(examRecoveryBlocked({ kind: 'bank_questions', result: null })).toBe(false)
  })
})
