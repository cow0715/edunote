export type ExamStudentConfirmation = {
  studentId: string | null
  confirmedStudentId: string | null
}

export function duplicateExamStudents(items: ExamStudentConfirmation[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const item of items) {
    if (!item.studentId) continue
    if (seen.has(item.studentId)) duplicates.add(item.studentId)
    seen.add(item.studentId)
  }
  return duplicates
}

export function isExamStudentConfirmed(item: ExamStudentConfirmation, duplicates: Set<string>): boolean {
  return !!item.studentId && item.confirmedStudentId === item.studentId && !duplicates.has(item.studentId)
}
