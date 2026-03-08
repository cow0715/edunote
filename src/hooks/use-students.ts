import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Student } from '@/lib/types'
import { toast } from 'sonner'

type StudentBody = {
  name: string
  phone: string
  father_phone: string
  mother_phone: string
  school: string
  grade: string
  memo: string
}

async function fetchStudents(): Promise<Student[]> {
  const res = await fetch('/api/students')
  if (!res.ok) throw new Error('학생 목록 조회 실패')
  return res.json()
}

export function useStudents() {
  return useQuery({ queryKey: ['students'], queryFn: fetchStudents })
}

export function useCreateStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: StudentBody) => {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['students'] }); toast.success('학생이 등록되었습니다') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & StudentBody) => {
      const res = await fetch(`/api/students/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['students'] }); toast.success('학생 정보가 수정되었습니다') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/students/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['students'] }); toast.success('학생이 삭제되었습니다') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useClassStudents(classId: string) {
  return useQuery({
    queryKey: ['class-students', classId],
    queryFn: async () => {
      const res = await fetch(`/api/classes/${classId}/students`)
      if (!res.ok) throw new Error('수업 학생 조회 실패')
      return res.json()
    },
  })
}

export function useAddClassStudent(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (studentId: string) => {
      const res = await fetch(`/api/classes/${classId}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['class-students', classId] }); toast.success('학생이 추가되었습니다') },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useRemoveClassStudent(classId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (studentId: string) => {
      const res = await fetch(`/api/classes/${classId}/students/${studentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['class-students', classId] }); toast.success('학생이 제거되었습니다') },
    onError: (e: Error) => toast.error(e.message),
  })
}
