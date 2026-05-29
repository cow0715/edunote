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
