import type { SupabaseServerClient } from '@/lib/api'

export async function assertMockExamOwner(
  supabase: SupabaseServerClient,
  id: string,
  teacherId: string,
) {
  const { data } = await supabase
    .from('mock_exam')
    .select('id')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .single()
  return !!data
}

export async function assertMockExamStudentAllowed(
  supabase: SupabaseServerClient,
  studentId: string,
  teacherId: string,
  classId: string | null,
  examDate: string | null,
) {
  const { data: student } = await supabase
    .from('student')
    .select('id')
    .eq('id', studentId)
    .eq('teacher_id', teacherId)
    .single()
  if (!student) return false

  if (!classId) return true

  const effectiveDate = examDate ?? new Date().toISOString().slice(0, 10)
  const { data: enrollment } = await supabase
    .from('class_student')
    .select('student_id')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .lte('joined_at', effectiveDate)
    .or(`left_at.is.null,left_at.gt.${effectiveDate}`)
    .maybeSingle()

  return !!enrollment
}
