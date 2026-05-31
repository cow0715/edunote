import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { MockExam, MockExamDetail, MockExamQuestion } from '@/lib/types'

type CreateMockExamBody = {
  title: string
  class_id?: string | null
  exam_year: number
  exam_month: number
  grade?: number | null
  source?: string
  exam_date?: string | null
}

type SaveMockExamResultBody = {
  student_id: string
  answers: { question_number: number; student_answer?: string | number | null }[]
  teacher_comment?: string | null
  status?: 'draft' | 'published'
}

type OcrMockExamBody = {
  student_id: string
  files: { fileData: string; mimeType: string; fileName?: string }[]
}

export type OmrBatchReviewItem = {
  page_number: number
  student_name: string | null
  answers: { question_number: number; student_answer: number | null }[]
  answered_count: number
  confidence: number
  status: 'saved' | 'review_required'
  matched_student_id: string | null
  matched_student_name: string | null
  match_score: number
  candidates: { id: string; name: string; school: string | null; grade: string | null; score: number }[]
  warnings: string[]
}

export type OmrBatchResponse = {
  pages_processed: number
  saved_count: number
  review_count: number
  items: OmrBatchReviewItem[]
}

export type MockExamReportRecipient = 'mother' | 'father' | 'student'

type OmrBatchBody = {
  files: { fileData: string; mimeType: string; fileName?: string }[]
}

type SendMockExamReportsBody = {
  result_ids: string[]
  recipients: MockExamReportRecipient[]
  message_template: string
}

type ImportMockExamMetadataBody = {
  raw_text?: string
  fileData?: string
  mimeType?: string
  fileName?: string
  files?: { fileData: string; mimeType: string; fileName?: string }[]
}

export function useMockExams() {
  return useQuery({
    queryKey: ['mock-exams'],
    queryFn: async (): Promise<MockExam[]> => {
      const res = await fetch('/api/mock-exams')
      if (!res.ok) throw new Error((await res.json()).error ?? '모의고사 목록 조회 실패')
      return res.json()
    },
  })
}

export function useMockExam(id: string | null) {
  return useQuery({
    queryKey: ['mock-exam', id],
    queryFn: async (): Promise<MockExamDetail> => {
      const res = await fetch(`/api/mock-exams/${id}`)
      if (!res.ok) throw new Error((await res.json()).error ?? '모의고사 조회 실패')
      return res.json()
    },
    enabled: !!id,
  })
}

export function useCreateMockExam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateMockExamBody): Promise<MockExam> => {
      const res = await fetch('/api/mock-exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '모의고사 생성 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mock-exams'] })
      toast.success('모의고사가 생성되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteMockExam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/mock-exams/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? '모의고사 삭제 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mock-exams'] })
      qc.invalidateQueries({ queryKey: ['mock-exam'] })
      toast.success('모의고사가 삭제되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateMockExamQuestions(id: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (questions: MockExamQuestion[]) => {
      const res = await fetch(`/api/mock-exams/${id}/questions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(questions),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '문항 저장 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mock-exam', id] })
      qc.invalidateQueries({ queryKey: ['mock-exams'] })
      toast.success('문항 메타데이터가 저장되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSaveMockExamResult(id: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: SaveMockExamResultBody) => {
      const res = await fetch(`/api/mock-exams/${id}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '답안 저장 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mock-exam', id] })
      qc.invalidateQueries({ queryKey: ['mock-exams'] })
      toast.success('답안이 저장되고 성적이 계산되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useOcrMockExamAnswers(id: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: OcrMockExamBody) => {
      const res = await fetch(`/api/mock-exams/${id}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '답안지 OCR 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mock-exam', id] })
      toast.success('답안지 OCR 결과를 불러왔습니다. 검수 후 저장해 주세요')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useOmrBatchMockExamAnswers(id: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: OmrBatchBody): Promise<OmrBatchResponse> => {
      const res = await fetch(`/api/mock-exams/${id}/omr-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'OMR 일괄 채점 실패')
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['mock-exam', id] })
      qc.invalidateQueries({ queryKey: ['mock-exams'] })
      toast.success(`OMR ${data.pages_processed}장을 처리했습니다. 자동 저장 ${data.saved_count}명, 확인 필요 ${data.review_count}명`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useImportMockExamMetadata(id: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ImportMockExamMetadataBody): Promise<{ questions: MockExamQuestion[]; imported_count: number; ready: boolean }> => {
      const res = await fetch(`/api/mock-exams/${id}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '메타데이터 분석 실패')
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['mock-exam', id] })
      qc.invalidateQueries({ queryKey: ['mock-exams'] })
      toast.success(`${data.imported_count}개 문항 메타데이터를 반영했습니다`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function usePublishMockExamReport(id: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (resultId: string) => {
      const res = await fetch(`/api/mock-exams/${id}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result_id: resultId }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '성적표 발행 실패')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mock-exam', id] })
      qc.invalidateQueries({ queryKey: ['mock-exams'] })
      toast.success('성적표 스냅샷이 발행되었습니다')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function usePublishMockExamReports(id: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (resultIds: string[]): Promise<{ published_count: number }> => {
      const uniqueIds = [...new Set(resultIds)].filter(Boolean)
      const res = await fetch(`/api/mock-exams/${id}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result_ids: uniqueIds }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '성적표 일괄 발행 실패')
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['mock-exam', id] })
      qc.invalidateQueries({ queryKey: ['mock-exams'] })
      toast.success(`성적표 ${data.published_count}개를 발행했습니다`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSendMockExamReports(id: string | null) {
  return useMutation({
    mutationFn: async (body: SendMockExamReportsBody): Promise<{ sent_count: number; failed_count: number; skipped: { reason: string }[] }> => {
      const res = await fetch(`/api/mock-exams/${id}/reports/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '성적표 문자 발송 실패')
      return res.json()
    },
    onSuccess: (data) => {
      const skippedText = data.skipped.length > 0 ? `, 제외 ${data.skipped.length}명` : ''
      toast.success(`문자 ${data.sent_count}건 발송 완료${data.failed_count ? `, 실패 ${data.failed_count}건` : ''}${skippedText}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
