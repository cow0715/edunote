'use client'

import { useState } from 'react'
import { errorMessage, runWithLoading } from '@/lib/async-ui'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Trash2, ChevronDown, ChevronUp, FileText, BarChart2, Loader2, BookOpen, Sparkles } from 'lucide-react'
import { confirmAiWork } from './constants'
import { QuestionList } from './question-list'
import { ExplanationUploadDialog } from './explanation-upload-dialog'
import type { ExamBank } from './types'

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
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart2 className="h-4 w-4" />}
    </Button>
  )
}

// ── 시험 목록 ─────────────────────────────────────────────────────────────

export function ExamList() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [explanationTarget, setExplanationTarget] = useState<string | null>(null)
  // useMutation: try/finally 로 로딩 state 를 관리하면 React Compiler 가 컴포넌트 전체를 건너뛴다(finally 미지원).
  const generateExplanation = useMutation({
    mutationFn: async (examId: string) => {
      const res = await fetch(`/api/exam-bank/${examId}/generate-explanation`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'AI 해설 생성 실패')
      return json as { updated: number; total: number }
    },
    onSuccess: (json) => toast.success(`AI 해설 생성 완료 (${json.updated}/${json.total}문항)`),
    onError: (error) => toast.error(error instanceof Error && error.message ? error.message : 'AI 해설 생성 실패'),
  })
  const generatingId = generateExplanation.isPending ? generateExplanation.variables ?? null : null

  const { data: exams, isLoading } = useQuery<ExamBank[]>({
    queryKey: ['exam-bank'],
    queryFn: () => fetch('/api/exam-bank').then((r) => r.json()),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/exam-bank/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      toast.success('삭제되었습니다')
    },
  })

  if (isLoading) return <p className="text-sm text-gray-500">불러오는 중...</p>
  if (!exams?.length) return <p className="text-sm text-gray-500">등록된 기출 시험이 없습니다.</p>

  return (
    <div className="space-y-3">
      {exams.map((exam) => {
        const isExpanded = expandedId === exam.id
        const qCount = exam.exam_bank_question?.[0]?.count ?? 0
        return (
          <div key={exam.id} className="rounded-2xl bg-white shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              {/* 아이콘 */}
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 shrink-0">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              {/* 정보 */}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : exam.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 truncate">{exam.title}</span>
                  <span className="text-xs text-gray-400 shrink-0">{exam.form_type}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">{exam.exam_year}년 {exam.exam_month}월 · 고{exam.grade}</span>
                  <span className="text-xs font-medium text-blue-600">{qCount}문항</span>
                </div>
              </div>
              {/* 액션 버튼 */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : exam.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <FetchStatsButton examId={exam.id} formType={exam.form_type || '홀수형'} />
                <button
                  onClick={() => setExplanationTarget(exam.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                  title="해설 PDF 업로드"
                >
                  <BookOpen className="h-4 w-4" />
                </button>
                <button
                  disabled={generatingId === exam.id}
                  onClick={() => {
                    if (!confirmAiWork()) return
                    generateExplanation.mutate(exam.id)
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="AI 해설/어휘 생성 (18~45번)"
                >
                  {generatingId === exam.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Sparkles className="h-4 w-4" />
                  }
                </button>
                <button
                  onClick={() => { if (confirm('이 시험과 모든 문항을 삭제하시겠습니까?')) deleteMutation.mutate(exam.id) }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {isExpanded && (
              <div className="border-t border-gray-100">
                <QuestionList examId={exam.id} />
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
