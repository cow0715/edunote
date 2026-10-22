'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { PdfImportKind, PdfImportStatus } from '@/lib/pdf-import/types'

type Job = { id: string; kind: PdfImportKind; target_id: string; status: PdfImportStatus; stage: string; completed_calls: number; attempt: number; error: string | null; can_retry: boolean; result: Record<string, unknown> | null }
const labels: Record<PdfImportKind, string> = { bank_questions: '문제은행 등록', bank_explanation: '문제은행 해설', bank_book: '교재 추출', week_answers: '주차 PDF 등록' }

export function PdfImportJobList({ weekId }: { weekId?: string }) {
  const client = useQueryClient()
  const completed = useRef(new Set<string>())
  const [retrying, setRetrying] = useState<string | null>(null)
  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ['pdf-import-jobs', weekId ?? 'bank'],
    queryFn: async () => {
      const response = await fetch(`/api/pdf-import/jobs${weekId ? `?weekId=${encodeURIComponent(weekId)}` : ''}`, { cache: 'no-store' })
      if (!response.ok) return [] // The old deployment works before its migration is installed.
      return response.json()
    },
    refetchInterval: (query) => query.state.data?.some((job) => job.status === 'queued' || job.status === 'running') ? 5_000 : 15_000,
  })
  useEffect(() => {
    const key = (job: Job) => `${job.id}:${job.status}:${job.attempt}`
    const fresh = jobs.filter((job) => (job.status === 'succeeded' || job.status === 'failed') && !completed.current.has(key(job)))
    if (!fresh.length) return
    fresh.forEach((job) => completed.current.add(key(job)))
    const prefixes = weekId ? ['exam-questions', 'grade', 'week'] : ['exam-bank', 'exam-bank-search', 'exam-bank-questions', 'book-pdf', 'vocab-collections']
    prefixes.forEach((prefix) => { void client.invalidateQueries({ queryKey: weekId ? [prefix, weekId] : [prefix] }) })
  }, [jobs, client, weekId])
  const filtered = jobs.filter((job) => job.status !== 'succeeded').concat(jobs.filter((job) => job.status === 'succeeded').slice(0, 3))
  if (!filtered.length) return null
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
  return <div className="space-y-2 rounded-xl bg-muted p-3" aria-label="PDF 처리 작업" aria-live="polite">
    <p className="text-sm font-medium">PDF 처리 작업</p>
    {filtered.map((job) => {
      const skipped = job.result?.skipped_questions ?? job.result?.skipped_pages
      return <div key={job.id} className="flex items-start justify-between gap-2 text-xs">
        <div>
          <p>{labels[job.kind]} · {job.stage} · 저장된 처리 결과 {job.completed_calls}개</p>
          {job.status === 'waiting_batch' && <p className="text-gray-500">이 화면을 닫아도 계속 처리되며, 배치 완료 후 자동으로 이어집니다.</p>}
          {job.error && <p className="mt-1 text-red-600">{job.error}</p>}
          {job.status === 'succeeded' && <p className="text-gray-500">{job.kind === 'bank_book' ? job.result?.auto_published ? '자동 검증을 통과해 문제은행과 단어장에 등록했습니다.' : '자동 복구 후에도 확정하지 못한 항목이 있어 등록을 보류했습니다. 처리 결과에 사유를 남겼습니다.' : '완료됐습니다. 자료 목록에 반영했습니다.'}</p>}
          {Array.isArray(skipped) && skipped.length > 0 && <p className="text-red-600">인식하지 못한 문항: {skipped.join(', ')}번</p>}
          {Number(job.result?.answers_deleted) > 0 && <p className="text-red-600">기존 학생 답안 {Number(job.result?.answers_deleted)}개가 삭제됐습니다. 해당 문항을 확인해주세요.</p>}
          {!!job.result?.subjective_grading_failed && <p className="text-red-600">서술형 재채점 결과를 확인해주세요.</p>}
        </div>
        {job.can_retry && <Button size="sm" variant="outline" disabled={retrying !== null} onClick={() => void retry(job.id)}>{retrying === job.id ? '요청 중' : '재실행'}</Button>}
      </div>
    })}
  </div>
}
