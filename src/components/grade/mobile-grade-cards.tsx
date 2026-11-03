"use client"
import { HomeworkInlineInput } from './homework-inline-input'
import { GradeScoreValue } from './grade-score-value'
import { AttendanceStatus } from './attendance-status'
import { GradeEditIcon } from './grade-edit-icon'
import { ParentReportLink } from './parent-report-link'
import { Button } from '@/components/ui/button'
import type { GradeRow } from '@/hooks/use-grade'

export function MobileGradeCards({ rows, vocabTotal, readingTotal, homeworkTotal, showExam, saving, shareTokens, onOpenAttendance, attendanceStatuses, onUpdate, onScoreSave, onOpen, onHomeworkValidity }: {
  onHomeworkValidity?: (id:string,invalid:boolean)=>void
  rows: GradeRow[]; vocabTotal: number; readingTotal: number; homeworkTotal: number; showExam: boolean; saving: boolean
  shareTokens?: Map<string, string>
  attendanceStatuses?: Map<string, string>
  onOpenAttendance?: () => void
  onUpdate: (studentId: string, key: keyof GradeRow, value: unknown) => void
  onScoreSave: (row: GradeRow) => void
  onOpen: (type: 'vocab' | 'exam', studentIndex: number) => void
}) {
 return <div className="space-y-3 md:hidden" aria-label="학생별 모바일 성적표">
  {rows.map((row,index)=><fieldset key={row.student_id} disabled={saving} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
   <legend className="sr-only">{row.student_name} 성적</legend>
   <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex min-w-0 flex-wrap items-center gap-2"><h3 className="min-w-0 break-words font-semibold">{row.student_name}</h3>{onOpenAttendance && <AttendanceStatus studentName={row.student_name} status={attendanceStatuses?.get(row.student_id)} />}</div>
    {shareTokens?.get(row.student_id) && <ParentReportLink token={shareTokens.get(row.student_id)!} studentName={row.student_name} />}
   </div>
   <div className="grid grid-cols-2 gap-2">
    {vocabTotal>0&&<Button type="button" className="group relative h-auto min-h-14 flex-col gap-1 whitespace-normal" disabled={saving} aria-label={`${row.student_name} 단어 답안 열기`} onClick={()=>onOpen('vocab',index)}><span className="text-xs text-muted-foreground">단어</span><GradeScoreValue correct={row.vocab_correct} total={vocabTotal} nullLabel="미응시" /><span className="absolute right-3 top-1/2 -translate-y-1/2"><GradeEditIcon /></span></Button>}
    {showExam&&<Button type="button" className="group relative h-auto min-h-14 flex-col gap-1 whitespace-normal" disabled={saving} aria-label={`${row.student_name} 시험 답안 열기`} onClick={()=>onOpen('exam',index)}><span className="text-xs text-muted-foreground">시험</span><GradeScoreValue correct={row.reading_correct} total={readingTotal} participating={row.reading_present} /><span className="absolute right-3 top-1/2 -translate-y-1/2"><GradeEditIcon /></span></Button>}
   </div>
   {homeworkTotal>0&&<div className="flex items-center justify-between text-sm"><span>숙제</span><HomeworkInlineInput studentName={row.student_name} value={row.homework_done} total={homeworkTotal} disabled={saving} onChange={value=>onUpdate(row.student_id,'homework_done',value)} onValidityChange={invalid=>onHomeworkValidity?.(row.student_id,invalid)}/></div>}
   <label className="flex items-center gap-3 text-sm"><span className="shrink-0">메모</span><input aria-label={`${row.student_name} 메모`} value={row.memo} disabled={saving} placeholder="학생 메모" onChange={e=>onUpdate(row.student_id,'memo',e.target.value)} onBlur={e=>onScoreSave({...row,memo:e.target.value})} className="min-h-11 flex-1 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-base disabled:opacity-50"/></label>
  </fieldset>)}
 </div>
}
