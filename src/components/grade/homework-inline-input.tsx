'use client'

import { useCallback, useRef, useState } from 'react'
import { GradeEditIcon } from './grade-edit-icon'

export function HomeworkInlineInput({ studentName, value, total, disabled, onChange, onValidityChange }: {
  studentName:string; value:number|null; total:number; disabled?:boolean
  onChange:(value:number|null)=>void
  onValidityChange:(invalid:boolean)=>void
}) {
  const [text,setText]=useState(value===null?'':String(value))
  const [editing,setEditing]=useState(false)
  const original=useRef(value)
  const edited=useRef(false)
  const focusInput=useCallback((node:HTMLInputElement|null)=>{if(node){node.focus();node.select()}},[])
  const valid=text.trim()==='' || (Number.isFinite(Number(text)) && Number(text)>=0 && Number(text)<=total)
  return <div data-homework-cell className="flex flex-col items-center gap-1">
    {editing ? <div className="flex items-center justify-center gap-1">
      <input ref={focusInput} type="text" inputMode="decimal" aria-label={`${studentName} 숙제 완료량`} aria-invalid={!valid} disabled={disabled} value={text} placeholder="미기록"
        onChange={event=>{
          edited.current=true
          const next=event.target.value
          setText(next)
          const number=next.trim()===''?null:Number(next)
          const invalid=number!==null && (!Number.isFinite(number)||number<0||number>total)
          onValidityChange(invalid)
          if(!invalid) onChange(number)
        }}
        onBlur={()=>setEditing(false)}
        onKeyDown={event=>{
          if(event.key==='Escape'){
            event.preventDefault();event.stopPropagation();if(edited.current && value!==original.current)onChange(original.current);setText(original.current===null?'':String(original.current));onValidityChange(false);setEditing(false)
          }
          if(event.key==='Enter'){
            event.preventDefault()
            if(!valid)return
            const scope=event.currentTarget.closest('table') ?? event.currentTarget.closest('[aria-label="학생별 모바일 성적표"]') ?? document
            const cells=Array.from(scope.querySelectorAll<HTMLElement>('[data-homework-cell]'))
            const current=event.currentTarget.closest('[data-homework-cell]')
            const next=cells.slice(cells.indexOf(current as HTMLElement)+1).map(cell=>cell.querySelector<HTMLButtonElement>('[data-homework-trigger]:not(:disabled)')).find(Boolean)
            setEditing(false)
            next?.click()
          }
        }}
        className="h-9 w-16 rounded-lg border border-border bg-background px-2 text-center text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-[var(--share-red)] disabled:opacity-40" />
      <span className="text-[11px] text-muted-foreground">/ {total}</span>
    </div> : <button type="button" data-homework-trigger aria-label={`${studentName} 숙제 수정`} disabled={disabled}
      onClick={()=>{original.current=value;edited.current=false;if(valid)setText(value===null?'':String(value));setEditing(true)}}
      className="group flex min-h-11 min-w-20 items-center justify-center gap-1 rounded-lg px-2 text-sm tabular-nums hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 md:min-h-9">
      {!valid ? <span className="font-semibold text-[var(--share-red)]">{text}</span> : value===null ? <span className="text-xs text-muted-foreground">미기록</span> : <><span className={value===0?'font-semibold text-[var(--share-red)]':'font-semibold'}>{value}</span><span className="text-[11px] text-muted-foreground">/ {total}</span></>}
      <GradeEditIcon />
    </button>}
    {!valid && <span role="alert" className="text-[10px] text-[var(--share-red)]">0~{total} 입력</span>}
  </div>
}
