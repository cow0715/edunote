"use client"
import { Button } from '@/components/ui/button'
import type { GradeRow } from '@/hooks/use-grade'

export function MobileGradeCards({ rows, vocabTotal, readingTotal, homeworkTotal, showExam, saving, onUpdate, onScoreSave, onOpen }: {
  rows: GradeRow[]; vocabTotal: number; readingTotal: number; homeworkTotal: number; showExam: boolean; saving: boolean
  onUpdate: (studentId: string, key: keyof GradeRow, value: unknown) => void
  onScoreSave: (row: GradeRow) => void
  onOpen: (type: 'vocab' | 'exam', studentIndex: number) => void
}) {
 return <div className="space-y-3 md:hidden" aria-label="학생별 모바일 성적표">
  {rows.map((row,index)=><fieldset key={row.student_id} disabled={saving} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4">
   <legend className="sr-only">{row.student_name} 성적</legend>
   <div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="min-w-0 break-words font-semibold">{row.student_name}</h3>
    <label className="flex min-h-11 items-center gap-2 rounded-lg bg-muted px-3 text-sm"><input type="checkbox" className="size-5 accent-primary" aria-label={`${row.student_name} 출석`} checked={row.present} onChange={e=>onUpdate(row.student_id,'present',e.target.checked)}/>{row.present?'출석':'결석'}</label>
   </div>
   <div className="grid grid-cols-2 gap-2">
    {vocabTotal>0&&<Button type="button" className="h-auto min-h-14 flex-col gap-1 whitespace-normal" disabled={!row.present} aria-label={`${row.student_name} 단어 답안 열기`} onClick={()=>onOpen('vocab',index)}><span className="text-xs text-muted-foreground">단어</span><span>{row.vocab_correct===null?'미채점':`${row.vocab_correct} / ${vocabTotal}`}</span></Button>}
    {showExam&&<Button type="button" className="h-auto min-h-14 flex-col gap-1 whitespace-normal" disabled={!row.present} aria-label={`${row.student_name} 시험 답안 열기`} onClick={()=>onOpen('exam',index)}><span className="text-xs text-muted-foreground">시험</span><span>{!row.reading_present?'미응시':row.reading_correct===null?'미채점':`${row.reading_correct} / ${readingTotal}`}</span></Button>}
   </div>
   {homeworkTotal>0&&<div className="flex flex-wrap items-center gap-2 text-sm"><label className="flex min-h-11 items-center gap-2">숙제<input type="number" inputMode="decimal" aria-label={`${row.student_name} 숙제 완료량`} min={0} max={homeworkTotal} step={0.5} disabled={!row.present} value={row.homework_done??''} placeholder="미제출" onChange={e=>onUpdate(row.student_id,'homework_done',e.target.value===''?null:Number(e.target.value))} onBlur={e=>onScoreSave({...row,homework_done:e.target.value===''?null:Number(e.target.value)})} className="h-11 w-24 rounded-lg border border-border bg-background px-2 text-base"/>/ {homeworkTotal}</label><Button type="button" variant="ghost" className="min-h-11" disabled={!row.present||row.homework_done===null} onClick={()=>{onUpdate(row.student_id,'homework_done',null);onScoreSave({...row,homework_done:null})}}>미제출로 변경</Button></div>}
   <label className="block text-sm">메모<input aria-label={`${row.student_name} 메모`} value={row.memo} disabled={!row.present} placeholder="학생 메모" onChange={e=>onUpdate(row.student_id,'memo',e.target.value)} onBlur={e=>onScoreSave({...row,memo:e.target.value})} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-base disabled:opacity-50"/></label>
  </fieldset>)}
 </div>
}
