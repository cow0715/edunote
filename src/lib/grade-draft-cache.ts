import type { GradeRow } from '@/hooks/use-grade'
export type GradeDraftCache = { savedAt: number; source: string; questions: string; rows: GradeRow[]; fields: string[] }
const prefix = 'edunote:grade-input:'
export function readGradeDraftCache(weekId: string): GradeDraftCache | null {
 try {
  if (typeof window === 'undefined') return null
  const value = JSON.parse(localStorage.getItem(prefix + weekId) ?? 'null')
  if (!value || !Number.isFinite(value.savedAt) || typeof value.source !== 'string' || typeof value.questions !== 'string' || !Array.isArray(value.fields) || !value.fields.every((field: unknown) => typeof field === 'string') || !Array.isArray(value.rows) || !value.rows.every((row: GradeRow) => row && typeof row.student_id === 'string' && Array.isArray(row.answers))) return null
  return {...value,rows:value.rows.map((row:GradeRow)=>({...row,present:true})),fields:value.fields.filter((field:string)=>!field.endsWith(':present'))}
 } catch { return null }
}
export function writeGradeDraftCache(weekId: string, value: GradeDraftCache | null): boolean {
 try {
  if (typeof window === 'undefined') return false
  if (value) localStorage.setItem(prefix + weekId, JSON.stringify(value))
  else localStorage.removeItem(prefix + weekId)
  return true
 } catch { return false }
}

// Compare only relevant grading records; do not persist student/parent contact data.
export function gradeDraftSource(data: { weekScores?: {student_id:string}[]; attendance?: {student_id:string}[] }, ids: string[]): string {
 const selected = new Set(ids)
 return JSON.stringify([(data.weekScores ?? []).filter(row => selected.has(row.student_id)), (data.attendance ?? []).filter(row => selected.has(row.student_id))])
}

/** Compare input only: a lost acknowledgement must not replace a newer AI verdict. */
export function sameDraftField(left: GradeRow, right: GradeRow, field: string): boolean {
 if (field !== 'answers') return JSON.stringify(left[field as keyof GradeRow]) === JSON.stringify(right[field as keyof GradeRow])
 const input = (row: GradeRow) => row.answers.map(a => [a.exam_question_id,a.student_answer ?? null,a.student_answer_text ?? '',a.ox_selection ?? null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
 return JSON.stringify(input(left)) === JSON.stringify(input(right))
}

export function draftFieldChangedOnServer(cache: GradeDraftCache, currentSource: string, studentId: string, field: string): boolean {
 const value = (source: string) => {
  const [scores] = JSON.parse(source) as [Record<string,unknown>[],Record<string,unknown>[]]
  const score = scores.find(row=>row.student_id===studentId)
  if (field==='answers') return ((score?.student_answer ?? []) as Record<string,unknown>[]).map(a=>[a.exam_question_id,a.student_answer??null,a.student_answer_text??'',a.ox_selection??null,a.is_correct??false,a.teacher_confirmed??false,a.needs_review??false,a.ai_feedback??'']).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
  if (field==='present') return true
  if (field==='reading_present') return score?.reading_correct != null
  return score?.[field] ?? (field==='memo' ? '' : null)
 }
 try { return JSON.stringify(value(cache.source))!==JSON.stringify(value(currentSource)) } catch { return true }
}
