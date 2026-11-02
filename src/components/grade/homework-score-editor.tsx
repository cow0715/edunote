"use client"

import { useId, useState } from 'react'
import { Popover } from 'radix-ui'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function HomeworkScoreEditor({ studentName, value, total, disabled, onSave }: {
  studentName: string
  value: number | null
  total: number
  disabled?: boolean
  onSave: (value: number | null) => Promise<void>
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const changeOpen = (next: boolean) => {
    if (next) { setText(value === null ? '' : String(value)); setInvalid(false) }
    setOpen(next)
  }
  async function commit(next: number | null) {
    if (pending) return
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > total)) {
      setInvalid(true)
      setError(`0부터 ${total} 사이로 입력해 주세요`)
      return
    }
    setText(next === null ? '' : String(next))
    setError(null)
    setInvalid(false)
    setPending(true)
    try {
      await onSave(next)
      setOpen(false)
    } catch {
      setError('저장 실패 · 입력은 유지됩니다')
    } finally { setPending(false) }
  }
  return <div className="flex flex-col items-center gap-1">
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <button type="button" disabled={disabled || pending} aria-label={`${studentName} 숙제 수정`} aria-busy={pending}
          className={cn('group inline-flex min-h-11 min-w-20 items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 md:min-h-9',value===0?'text-[var(--share-red)]':value===null?'text-muted-foreground':'text-foreground')}>
          {value===null ? <span className="text-xs">미기록</span> : <span className="tabular-nums"><span className="font-semibold">{value}</span><span className="ml-0.5 text-[11px] text-muted-foreground">/ {total}</span></span>}
          {pending ? <LoaderCircle aria-label="숙제 저장 중" className="size-3.5 animate-spin"/> : <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground opacity-60"/>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="center" sideOffset={6} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
          className="z-50 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-[20px] border border-border bg-popover p-4 text-popover-foreground outline-none">
          <div><h3 id={`${id}-title`} className="text-sm font-semibold">{studentName} · 숙제</h3><p id={`${id}-description`} className="mt-1 text-xs text-muted-foreground">전체 {total}개 · 소수 입력 가능</p></div>
          <div className="grid grid-cols-3 gap-1.5">{[{label:'미기록',score:null},{label:'미제출',score:0},{label:'완료',score:total}].map(({label,score})=><Button key={label} type="button" variant="outline" className="min-h-11 px-2 text-xs" disabled={disabled || pending} aria-pressed={text===(score===null?'':String(score))} onClick={()=>void commit(score)}>{label}</Button>)}</div>
          <form className="space-y-3" noValidate onSubmit={event=>{event.preventDefault();void commit(text.trim()===''?null:Number(text))}}>
            <label className="block text-xs text-muted-foreground" htmlFor={`${id}-value`}>완료량</label>
            <div className="flex items-center gap-2"><input id={`${id}-value`} type="number" inputMode="decimal" min={0} max={total} step="any" value={text} placeholder="미기록" aria-label={`${studentName} 숙제 완료량`} aria-invalid={invalid} disabled={disabled || pending} onChange={event=>{setText(event.target.value);setInvalid(false);setError(null)}} className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"/><span className="text-sm text-muted-foreground">/ {total}</span></div>
            {error && <p role="alert" className="text-xs text-[var(--share-red)]">{error}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="min-h-11" onClick={()=>setOpen(false)}>취소</Button><Button type="submit" variant="action" className="min-h-11" disabled={disabled || pending}>{pending?'저장 중…':'저장'}</Button></div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {!open && error && <button type="button" className="text-[11px] text-[var(--share-red)]" onClick={()=>changeOpen(true)}>저장 실패 · 다시 시도</button>}
  </div>
}
