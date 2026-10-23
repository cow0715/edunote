'use client'

import { useState } from 'react'
import { errorMessage, runWithLoading } from '@/lib/async-ui'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Trash2, ChevronDown, ChevronUp, FileText, BarChart2, Loader2, BookOpen } from 'lucide-react'
import { QuestionList } from './question-list'
import { ExplanationUploadDialog } from './explanation-upload-dialog'
import type { ExamBank } from './types'
import { useBookDocuments } from './book-upload-form'

// ── 메가스터디 통계 버튼 ──────────────────────────────────────────────────

function FetchStatsButton({ examId, formType }: { examId: string; formType: string }) {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)

  const handleFetch = async () => {
    await runWithLoading(setLoading, async () => {
      const res = await fetch(`/api/exam-bank/${examId}/fetch-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_type: formType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`통계 저장 완료 (${data.updated}/${data.total}문항)`)
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
    }, (e) => toast.error(errorMessage(e, '통계 가져오기 실패')))
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleFetch}
      disabled={loading}
      title="메가스터디 통계 가져오기"
      aria-label="메가스터디 통계 가져오기"
      className="min-h-11 min-w-11"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart2 className="h-4 w-4" />}
    </Button>
  )
}

// ── 시험 목록 ─────────────────────────────────────────────────────────────

export function ExamList({ selectedId, onOpenBook, onRegister }: { selectedId?: string | null; onOpenBook?: (id: string) => void; onRegister?: () => void }) {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(selectedId ?? null)
  const [syncedSelection, setSyncedSelection] = useState<string | null>(null)
  if (selectedId && syncedSelection !== selectedId) { setSyncedSelection(selectedId); setExpandedId(selectedId) }
  const [kind, setKind] = useState('all'), books = useBookDocuments()
  const [explanationTarget, setExplanationTarget] = useState<string | null>(null)
  // AI 해설 생성 버튼은 제거됨 — 해설 PDF 업로드가 추출 후 generate-explanation 을 자동으로 이어 호출한다.

  const { data: exams, isLoading, error, refetch } = useQuery<ExamBank[]>({
    queryKey: ['exam-bank'],
    queryFn: async () => { const r = await fetch('/api/exam-bank'), data = await r.json(); if (!r.ok) throw new Error(data.error || '자료 조회 실패'); return data },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/exam-bank/${id}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '삭제 실패')
      return data
    },
    onError: (error) => toast.error(error.message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      toast.success('삭제되었습니다')
    },
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  if (error) return <div role="alert"><p>{error.message}</p><Button onClick={() => void refetch()}>다시 불러오기</Button></div>
  if (!exams?.length) return <div className="space-y-3"><p className="text-sm text-muted-foreground">등록된 자료가 없습니다.</p>{onRegister && <Button onClick={onRegister}>자료 등록</Button>}</div>
  const visible = exams.filter((exam) => kind === 'all' || (kind === 'book' ? exam.material_kind === 'textbook' : exam.material_kind !== 'textbook'))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" aria-label="자료 종류 필터">{[['all','전체'],['exam','기출'],['book','교재']].map(([value,label]) => <Button key={value} aria-pressed={kind === value} variant={kind === value ? 'secondary' : 'ghost'} className="min-h-11" onClick={() => setKind(value)}>{label}</Button>)}</div>
      {!visible.length && <p className="text-sm text-muted-foreground">이 종류에 등록된 자료가 없습니다.</p>}
      {visible.map((exam) => {
        const isExpanded = expandedId === exam.id
        const qCount = exam.exam_bank_question?.[0]?.count ?? 0
        return (
          <div key={exam.id} className="rounded-xl border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              {/* 아이콘 */}
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-muted shrink-0">
                <FileText className="h-4 w-4 text-foreground" />
              </div>
              {/* 정보 */}
              <button
                aria-expanded={isExpanded}
                className="min-h-11 min-w-0 flex-1 text-left"
                onClick={() => setExpandedId(isExpanded ? null : exam.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground truncate">{exam.title}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{exam.form_type}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">{exam.material_kind === 'textbook' ? `교재${exam.exam_year ? ` · ${exam.exam_year}학년도` : ''}` : `${exam.exam_year}년 ${exam.exam_month}월 · 고${exam.grade}`}</span>
                  <span className="text-xs font-medium text-foreground">{qCount}문항</span>
                </div>
              </button>
              {/* 액션 버튼 */}
              <div className="flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto">
                {exam.material_kind === 'textbook' && onOpenBook && books.data?.documents.find((d) => d.exam_bank_id === exam.id) && <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onOpenBook(books.data!.documents.find((d) => d.exam_bank_id === exam.id)!.id)}>분류·처리 상세</Button>}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : exam.id)}
                  aria-label={isExpanded ? `${exam.title} 접기` : `${exam.title} 문항 보기`}
                  className="min-h-11 min-w-11 rounded-lg p-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {exam.material_kind !== 'textbook' && <FetchStatsButton examId={exam.id} formType={exam.form_type || '홀수형'} />}
                {exam.material_kind !== 'textbook' && (
                <button
                  onClick={() => setExplanationTarget(exam.id)}
                  className="min-h-11 min-w-11 rounded-lg p-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="해설 PDF 업로드"
                >
                  <BookOpen className="h-4 w-4" />
                </button>
                )}
                <button
                  onClick={() => { if (confirm('이 자료와 모든 문항을 삭제하시겠습니까?')) deleteMutation.mutate(exam.id) }}
                  aria-label={`${exam.title} 삭제`}
                  className="min-h-11 min-w-11 rounded-lg p-3 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {isExpanded && (
              <div className="border-t border-border">
                <QuestionList examId={exam.id} bookMode={exam.material_kind === 'textbook'} />
              </div>
            )}
          </div>
        )
      })}
      <ExplanationUploadDialog
        examId={explanationTarget}
        onOpenChange={(open) => { if (!open) setExplanationTarget(null) }}
      />
    </div>
  )
}
