import { describe, expect, it } from 'vitest'
import { auditExamStorage, type ExamCheckpointText, type StoredExamQuestion } from '@/lib/pdf-import/exam-storage-audit'
import { examImportIssues } from '@/lib/pdf-import/exam-completeness'
import type { PdfImportJob } from '@/lib/pdf-import/types'

const job = { id: 'job', teacher_id: 'teacher', target_id: 'exam', kind: 'bank_explanation', status: 'succeeded',
  result: { total: 28, updated: 27, mode: 'standard', skipped_questions: [] } } as unknown as PdfImportJob
const numbers = Array.from({ length: 28 }, (_, i) => i + 18)
const stored = (n: number): StoredExamQuestion => ({ question_number: n, explanation_intent: '의도', explanation_translation: '해석', explanation_solution: '풀이', explanation_vocabulary: '어휘' })
const response = (ns: number[], task = 'examBank.extractExplanations'): ExamCheckpointText => ({ task,
  text: '```json\n' + JSON.stringify(ns.map((question_number) => ({ question_number, intent: '의도', translation: '해석', solution: '풀이', vocabulary: '어휘' }))) + '\n```' })

describe('stored exam material reconciliation without reparsing', () => {
  it('finds legacy 25 with no question row even though its extraction succeeded and skipped is empty', () => {
    const result = auditExamStorage(job, numbers.filter((n) => n !== 25).map(stored), [response(numbers)])
    expect(examImportIssues(result.result)).toEqual([{ stage: 'explanations', question_number: 25, code: 'unmatched',
      reason: '현재 문제은행에 해당 번호의 문항이 없어 해설을 연결할 수 없습니다.', attempts: 0 }])
    expect(job.result).not.toHaveProperty('storage_issues')
    expect(result.result).not.toHaveProperty('text')
  })
  it('identifies a missing question row using actual stored numbers even with no cached output', () => {
    const result = auditExamStorage({ ...job, kind: 'bank_questions', result: { question_count: 28, skipped_pages: [] } }, numbers.filter((n) => n !== 30).map(stored), [])
    expect(examImportIssues(result.result)).toMatchObject([{ stage: 'questions', question_number: 30, reason: expect.stringContaining('저장') }])
  })
  it('checks question and separate explanation stages independently and preserves detailed failure reasons', () => {
    const detail = { stage: 'explanations', question_number: 31, code: 'refusal', reason: '콘텐츠 필터 거절', attempts: 3 }
    const result = auditExamStorage({ ...job, kind: 'bank_questions', result: { issues: [], explanation_result: { total: 28, issues: [detail] } } },
      numbers.filter((n) => n !== 31).map(stored), [response(numbers)])
    expect(examImportIssues(result.result)).toHaveLength(2)
    expect(examImportIssues(result.result)).toContainEqual(detail)
  })
  it('detects a missing saved explanation field rather than overwriting edited content', () => {
    const rows = numbers.map(stored)
    rows[0].explanation_translation = '강사가 수정한 해석'
    rows[1].explanation_solution = ''
    const issues = examImportIssues(auditExamStorage(job, rows, [response(numbers)]).result)
    expect(issues).toMatchObject([{ stage: 'explanations', question_number: 19, reason: '기존 처리 결과의 풀이 정보가 현재 문항에 저장되어 있지 않습니다.' }])
  })
  it('uses cached numbers to discover an unlinked response outside the current saved question set', () => {
    const result = auditExamStorage({ ...job, result: { total: 2, updated: 1, mode: 'standard' } }, [stored(18)], [response([18, 25])])
    expect(examImportIssues(result.result)).toMatchObject([{ question_number: 25, code: 'unmatched' }])
  })
  it('withholds completion instead of inventing missing numbers when the old count cannot be reconciled', () => {
    const result = auditExamStorage({ ...job, result: { total: 3, updated: 2, mode: 'standard' } }, [stored(18), stored(19)], [])
    expect(result.result.storage_check_error).toContain('누락 번호를 확정할 수 없습니다')
    expect(examImportIssues(result.result)).toEqual([])
  })
  it('keeps complete results and explicit historical exclusions valid, without expecting listening items', () => {
    expect(examImportIssues(auditExamStorage(job, numbers.map(stored), [response(numbers)]).result)).toEqual([])
    const result = auditExamStorage({ ...job, kind: 'bank_questions', result: { excluded_questions: [{ question_number: 25, reason: '당시 도표 제외' }] } }, numbers.filter((n) => n !== 25).map(stored), [])
    expect(examImportIssues(result.result)).toEqual([])
    const separate = auditExamStorage({ ...job, kind: 'bank_questions', result: { ...result.result, explanation_result: { total: 28, updated: 27 } } }, numbers.filter((n) => n !== 25).map(stored), [response(numbers)])
    expect(examImportIssues(separate.result)).toEqual([])
    expect(separate.result.storage_check_error).toBeNull()
    expect(examImportIssues(auditExamStorage({ ...job, result: { total: 1 } }, [stored(1), stored(18)], [response([18])]).result)).toEqual([])
  })
  it('does not mistake inventory responses for extracted numbered material', () => {
    const result = auditExamStorage({ ...job, result: { total: 1 } }, [stored(18)], [{ task: 'examBank.extractExplanations', text: '[18,25]' }])
    expect(examImportIssues(result.result)).toEqual([])
  })
})
