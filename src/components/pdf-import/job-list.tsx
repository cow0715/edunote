'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { PdfImportKind } from '@/lib/pdf-import/types'
import { usePdfImportJobs, type ImportJob } from './use-jobs'
import { examImportIssues, type ExamImportExclusion } from '@/lib/pdf-import/exam-completeness'

const EMPTY_JOBS: ImportJob[] = []

const labels: Record<PdfImportKind, string> = { bank_questions: '문제은행 등록', bank_explanation: '문제은행 해설', bank_book: '교재 추출', week_answers: '주차 PDF 등록' }

export function PdfImportJobList({ weekId, onOpenBook, onOpenMaterial }: { weekId?: string; onOpenBook?: (id: string) => void; onOpenMaterial?: (id: string) => void }) {
  const client = useQueryClient()
  const completed = useRef(new Set<string>())
  const [retrying, setRetrying] = useState<string | null>(null)
  const query = usePdfImportJobs(weekId), jobs = query.data ?? EMPTY_JOBS
  useEffect(() => {
    const key = (job: (typeof jobs)[number]) => `${job.id}:${job.status}:${job.attempt}`
    const fresh = jobs.filter((job) => (job.status === 'succeeded' || job.status === 'failed') && !completed.current.has(key(job)))
    if (!fresh.length) return
    fresh.forEach((job) => completed.current.add(key(job)))
    const prefixes = weekId ? ['exam-questions', 'grade', 'week', 'answer-review'] : ['exam-bank', 'exam-bank-search', 'exam-bank-question-search', 'exam-bank-questions', 'book-pdf', 'vocab-collections']
    prefixes.forEach((prefix) => { void client.invalidateQueries({ queryKey: weekId ? [prefix, weekId] : [prefix] }) })
  }, [jobs, client, weekId])
  const filtered = jobs.filter((job) => job.status !== 'succeeded').concat(jobs.filter((job) => job.status === 'succeeded').slice(0, weekId ? 3 : 30))
  if (query.error) return <div role="alert" className="rounded-xl border p-4 text-sm"><p>{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>다시 불러오기</Button></div>
  if (!filtered.length) return weekId ? null : <p className="text-sm text-muted-foreground">{query.isLoading ? '처리 내역을 불러오는 중…' : '등록 내역이 없습니다.'}</p>
  async function retry(id: string) {
    setRetrying(id)
    try {
      const response = await fetch(`/api/pdf-import/jobs/${id}`, { method: 'POST' })
      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error || '재실행 실패')
      }
      toast.success('재실행을 요청했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '재실행 요청 실패')
    } finally {
      setRetrying(null)
      await client.invalidateQueries({ queryKey: ['pdf-import-jobs'] })
    }
  }
  return <div className="space-y-2 rounded-xl border bg-card p-4" aria-label="PDF 처리 작업" aria-live="polite">
    <p className="text-sm font-medium">최근 등록·처리 내역</p>
    {filtered.map((job) => {
      const examJob = job.kind === 'bank_questions' || job.kind === 'bank_explanation'
      const issues = examJob ? examImportIssues(job.result) : []
      const skipped = examJob ? null : job.result?.skipped_questions ?? job.result?.skipped_pages
      const exclusions = Array.isArray(job.result?.excluded_questions) ? job.result.excluded_questions as ExamImportExclusion[] : []
      return <div key={job.id} className="flex flex-wrap items-start justify-between gap-3 border-t py-3 text-sm">
        <div>
          <p className="font-medium break-words">{job.display_title || labels[job.kind]}</p>
          <p className="mt-1 text-sm text-muted-foreground">{issues.length ? '문항 처리 미완료' : job.status === 'waiting_batch' ? '응답 대기' : job.status === 'queued' ? '접수 완료' : job.status === 'succeeded' ? job.result?.needs_review ? '검토 초안 생성 완료' : '등록 완료' : job.status === 'failed' ? '등록 보류·처리 실패' : '처리 중'} · {job.stage}</p>
          {job.progress && job.progress.total > 0 && <p className="text-sm text-muted-foreground">처리 완료 {job.progress.completed}/{job.progress.total}지문 · 전체 {job.progress.questions}문항</p>}
          {job.updated_at && <p className="mt-1 text-xs text-muted-foreground">마지막 처리 {new Date(job.updated_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
          {job.status === 'waiting_batch' && job.resume_after && <p className="text-xs text-muted-foreground">다음 상태 확인 {new Date(job.resume_after).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</p>}
          {job.status === 'waiting_batch' && <p className="text-muted-foreground">이 화면을 닫아도 계속 처리되며, 배치 완료 후 자동으로 이어집니다.</p>}
          {job.error && <p className="mt-1 text-destructive">{job.error}</p>}
          {job.status === 'succeeded' && !issues.length && <p className="text-muted-foreground">{job.kind === 'bank_book' ? job.result?.auto_published ? '자동 검증을 통과해 문제은행과 단어장에 등록했습니다.' : '자동 복구 후에도 확정하지 못한 항목이 있어 등록을 보류했습니다. 처리 결과에 사유를 남겼습니다.' : job.result?.needs_review ? '검토 초안을 만들었습니다. 아래에서 원문 정답을 확인하고 확정해 주세요. 기존 정답과 학생 답안은 변경하지 않았습니다.' : '완료됐습니다. 자료 목록에 반영했습니다.'}</p>}
          {issues.length > 0 && <div className="mt-2" role="alert">
            <p className="text-destructive">복구하지 못한 문항 {issues.length}개가 남아 있습니다. 성공한 결과는 저장했습니다.</p>
            <ul className="mt-1 space-y-1 text-destructive" aria-label="미완료 문항과 사유">
              {issues.map((issue) => <li key={`${issue.stage}-${issue.question_number}`}>{issue.stage === 'questions' ? '문제' : '해설'} {issue.question_number}번: {issue.reason}</li>)}
            </ul>
          </div>}
          {exclusions.length > 0 && <details className="mt-2 text-muted-foreground"><summary>추출 대상 제외 {exclusions.length}문항</summary>
            <ul className="mt-1 space-y-1">{exclusions.map((item) => <li key={item.question_number}>{item.question_number}번: {item.reason}</li>)}</ul>
          </details>}
          {Array.isArray(skipped) && skipped.length > 0 && <p className="text-destructive">인식하지 못한 문항: {skipped.join(', ')}번</p>}
          {Number(job.result?.answers_deleted) > 0 && <p className="text-destructive">기존 학생 답안 {Number(job.result?.answers_deleted)}개가 삭제됐습니다. 해당 문항을 확인해주세요.</p>}
          {!!job.result?.subjective_grading_failed && <p className="text-destructive">서술형 재채점 결과를 확인해주세요.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
        {job.kind === 'bank_book' && onOpenBook && <Button size="sm" variant="outline" className="min-h-11" onClick={() => onOpenBook(job.target_id)}>처리 상세</Button>}
        {(job.status === 'succeeded' || issues.length > 0) && job.kind !== 'bank_book' && onOpenMaterial && <Button size="sm" variant="outline" className="min-h-11" onClick={() => onOpenMaterial(String(job.result?.exam_id ?? job.target_id))}>{issues.length ? '저장된 자료 보기' : '자료 보기'}</Button>}
        {job.can_retry && <Button size="sm" variant="outline" disabled={retrying !== null} onClick={() => void retry(job.id)}>{retrying === job.id ? '요청 중' : '재실행'}</Button>}
        </div>
      </div>
    })}
  </div>
}
