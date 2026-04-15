import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ReportCard, ReportMetrics, PeriodType, PeriodComparison, ClassContext, AcademyProfile } from '@/lib/report-card'

export type ReportCardListItem = ReportCard

export interface ReportCardDetail {
  card: ReportCard
  student: { id: string; name: string; school: string | null; grade: string | null; student_code: string | null }
  metrics: ReportMetrics
  previous: PeriodComparison | null
  academy: AcademyProfile
  classContext: ClassContext | null
}

export function useReportCards(studentId: string | undefined) {
  return useQuery({
    queryKey: ['report-cards', studentId],
    queryFn: async (): Promise<ReportCardListItem[]> => {
      const res = await fetch(`/api/report-cards?studentId=${studentId}`)
      if (!res.ok) throw new Error((await res.json()).error ?? '성적표 목록 조회 실패')
      return res.json()
    },
    enabled: !!studentId,
  })
}

export function useReportCard(id: string | undefined) {
  return useQuery({
    queryKey: ['report-card', id],
    queryFn: async (): Promise<ReportCardDetail> => {
      const res = await fetch(`/api/report-cards/${id}`)
      if (!res.ok) throw new Error((await res.json()).error ?? '성적표 조회 실패')
      return res.json()
    },
    enabled: !!id,
  })
}

export function useCreateReportCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      student_id: string
      period_type: PeriodType
      period_start: string
      period_end: string
      period_label: string
    }): Promise<ReportCard> => {
      const res = await fetch('/api/report-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '성적표 생성 실패')
      return res.json()
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['report-cards', vars.student_id] })
      toast.success('성적표가 생성되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateReportCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: {
      id: string
      overall_grade?: string | null
      teacher_comment?: string | null
      next_focus?: string | null
      summary_text?: string | null
      highlighted_wrong_ids?: string[]
      status?: 'draft' | 'published'
    }): Promise<ReportCard> => {
      const res = await fetch(`/api/report-cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '성적표 수정 실패')
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['report-card', data.id] })
      qc.invalidateQueries({ queryKey: ['report-cards', data.student_id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteReportCard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string; studentId: string }) => {
      const res = await fetch(`/api/report-cards/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? '성적표 삭제 실패')
    },
    onSuccess: (_data, { studentId }) => {
      qc.invalidateQueries({ queryKey: ['report-cards', studentId] })
      toast.success('성적표가 삭제되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
