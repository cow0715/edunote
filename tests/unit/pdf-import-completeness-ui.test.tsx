// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ImportJob } from '@/components/pdf-import/use-jobs'
const data = vi.hoisted(() => ({ jobs: [] as ImportJob[] }))
vi.mock('@/components/pdf-import/use-jobs', () => ({ usePdfImportJobs: () => ({ data: data.jobs, error: null, isLoading: false }) }))
import { PdfImportJobList } from '@/components/pdf-import/job-list'

let client: QueryClient
beforeEach(() => { client = new QueryClient(); data.jobs = [] })
afterEach(() => { cleanup(); client.clear() })
const base: ImportJob = { id: 'job', kind: 'bank_questions', target_id: 'exam', status: 'failed', stage: '저장', completed_calls: 27, attempt: 1, error: null, can_retry: false, result: null }
function show() {
  const open = vi.fn()
  render(<QueryClientProvider client={client}><PdfImportJobList onOpenMaterial={open} /></QueryClientProvider>)
  return open
}
describe('incomplete exam registration UI', () => {
  it('shows missing question and explanation numbers and reasons with access to saved results', () => {
    data.jobs = [{ ...base, result: { exam_incomplete: true, exam_id: 'exam', skipped_pages: [22], issues: [{ stage: 'questions', question_number: 22, reason: '콘텐츠 필터로 거절됐습니다.', attempts: 3 }],
      explanation_result: { issues: [{ stage: 'explanations', question_number: 42, reason: '응답에 요청한 번호가 없습니다.', attempts: 3 }] } } }]
    const open = show()
    expect(screen.getByText(/문항 처리 미완료/)).toBeTruthy()
    expect(screen.getByText('문제 22번: 콘텐츠 필터로 거절됐습니다.')).toBeTruthy()
    expect(screen.getByText('해설 42번: 응답에 요청한 번호가 없습니다.')).toBeTruthy()
    expect(screen.queryByText(/등록 완료/)).toBeNull(); expect(screen.queryByRole('button', { name: '재실행' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '저장된 자료 보기' })); expect(open).toHaveBeenCalledWith('exam')
  })
  it('does not claim completion for older succeeded jobs with skipped numbers', () => {
    data.jobs = [{ ...base, status: 'succeeded', result: { skipped_pages: [30] } }]
    show()
    expect(screen.getByText(/문제 30번:/)).toBeTruthy(); expect(screen.queryByText(/등록 완료/)).toBeNull()
  })
  it('shows a legacy storage mismatch with its number and factual linking reason', () => {
    data.jobs = [{ ...base, kind: 'bank_explanation', status: 'succeeded', result: { total: 28, updated: 27, skipped_questions: [],
      storage_issues: [{ stage: 'explanations', question_number: 25, code: 'unmatched', reason: '현재 문제은행에 해당 번호의 문항이 없어 해설을 연결할 수 없습니다.', attempts: 0 }] } }]
    show()
    expect(screen.getByText('해설 25번: 현재 문제은행에 해당 번호의 문항이 없어 해설을 연결할 수 없습니다.')).toBeTruthy()
    expect(screen.getByText(/문항 처리 미완료/)).toBeTruthy()
    expect(screen.queryByText(/등록 완료/)).toBeNull()
    expect(screen.queryByText(/완료됐습니다/)).toBeNull()
    expect(screen.queryByRole('button', { name: '재실행' })).toBeNull()
  })
  it('does not turn a failed storage check into a completion claim or an invented missing number', () => {
    data.jobs = [{ ...base, status: 'succeeded', result: { storage_check_error: '저장 자료를 대조하지 못했습니다.' } }]
    show()
    expect(screen.getByText(/저장 대조 확인 필요/)).toBeTruthy()
    expect(screen.getByText('저장 자료를 대조하지 못했습니다.')).toBeTruthy()
    expect(screen.queryByText(/등록 완료|완료됐습니다/)).toBeNull()
    expect(screen.queryByRole('list', { name: '미완료 문항과 사유' })).toBeNull()
  })
  it('separately explains intentional chart exclusions without marking successful text extraction failed', () => {
    data.jobs = [{ ...base, status: 'succeeded', result: { excluded_questions: [{ question_number: 25, reason: '도표·그래프 제외' }] } }]
    show()
    expect(screen.getByText(/등록 완료/)).toBeTruthy(); expect(screen.getByText('추출 대상 제외 1문항')).toBeTruthy()
    expect(screen.getByText('25번: 도표·그래프 제외')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull()
  })
})
