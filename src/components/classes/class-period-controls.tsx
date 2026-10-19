'use client'

import { useState } from 'react'
import { MoreHorizontal, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { ClassPeriod, Week } from '@/lib/types'
import { isWeekInPeriod } from '@/lib/class-periods'

type Props = {
  className: string
  periods: ClassPeriod[]
  weeks: Week[]
  value: string
  onValueChange: (value: string) => void
  onCreate: () => void
  onEdit: (period: ClassPeriod) => void
  onSetDefault: (period: ClassPeriod) => void
  onDelete: (period: ClassPeriod) => void
  loading?: boolean
  error?: boolean
  onRetry: () => void
}

export function ClassPeriodControls({ className, periods, weeks, value, onValueChange, onCreate, onEdit, onSetDefault, onDelete, loading, error, onRetry }: Props) {
  const [open, setOpen] = useState(false)
  const selected = periods.find(period => period.id === value)
  const shared = periods.find(period => period.is_current)
  const count = selected ? weeks.filter(week => isWeekInPeriod(week, selected)).length : weeks.length
  const ordered = [...periods].sort((a, b) => b.start_date.localeCompare(a.start_date) || b.sort_order - a.sort_order)

  function manage(action: () => void) {
    setOpen(false)
    action()
  }

  if (error) return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl bg-gray-50 p-4 text-sm">
      <p>학습기간을 불러오지 못했어요.</p>
      <Button variant="outline" onClick={onRetry}>다시 시도</Button>
    </div>
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
    <section className="mb-6 border-b pb-5" aria-label="학습기간">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 hidden text-sm text-gray-500 sm:inline">학습기간</span>
        <Select value={value} onValueChange={onValueChange} disabled={loading}>
          <SelectTrigger aria-label="조회할 학습기간" className="h-11 w-0 min-w-0 flex-1 rounded-xl border-0 bg-gray-100 font-semibold shadow-none sm:w-auto sm:min-w-36 sm:max-w-sm sm:flex-none">
            <SelectValue placeholder="불러오는 중…" />
          </SelectTrigger>
          <SelectContent className="shadow-none">
            {ordered.map(period => <SelectItem key={period.id} value={period.id}>{period.label}{period.is_current ? ' · 공유 기본' : ''}</SelectItem>)}
            <SelectItem value="all">전체 기간</SelectItem>
          </SelectContent>
        </Select>
        <SheetTrigger asChild><Button variant="ghost" className="ml-auto h-11 shrink-0 rounded-xl" disabled={loading}>기간 관리</Button></SheetTrigger>
      </div>
      {!loading && <p className="mt-2 text-xs leading-5 text-gray-500" aria-live="polite">
        {selected ? `${selected.start_date.replaceAll('-', '.')} ~ ${selected.end_date?.replaceAll('-', '.') ?? '종료일 미정'} · ` : ''}수업 {count}회
        {shared && selected?.id !== shared.id && <span className="block sm:ml-3 sm:inline">학부모 공유 기본은 {shared.label}</span>}
        {!shared && <span className="block">공유 기본 기간이 없어요. 기간 관리에서 지정해 주세요.</span>}
      </p>}

        <SheetContent className="w-full overflow-y-auto shadow-none sm:max-w-md" showCloseButton={false}>
          <SheetClose asChild><Button variant="ghost" className="absolute right-3 top-3 h-11 w-11" aria-label="기간 관리 닫기"><X className="h-5 w-5" /></Button></SheetClose>
          <SheetHeader className="px-6 pt-8">
            <SheetDescription>{className}</SheetDescription>
            <SheetTitle className="text-2xl">학습기간 관리</SheetTitle>
          </SheetHeader>
          <div className="px-6 pb-8">
            <Button className="mb-6 h-12 w-full rounded-xl" onClick={() => manage(onCreate)}><Plus className="h-4 w-4" />새 기간 시작</Button>
            <p className="mb-3 text-xs leading-5 text-gray-500">공유 기본 기간은 학생·학부모가 리포트를 열 때 처음 보여요.</p>
            <div className="divide-y">
              {ordered.map(period => <div key={period.id} className="flex items-center gap-3 py-5">
                <div className="min-w-0 flex-1">
                  {period.is_current && <span className="mb-2 inline-block rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">학부모 공유 기본</span>}
                  <p className="break-words font-semibold text-gray-900">{period.label}</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{period.start_date.replaceAll('-', '.')} ~ {period.end_date?.replaceAll('-', '.') ?? '종료일 미정'}</p>
                  <p className="text-xs leading-5 text-gray-500">{period.semester}학기 · {period.exam_type === 'midterm' ? '중간고사' : period.exam_type === 'final' ? '기말고사' : '기타'} · 수업 {weeks.filter(week => isWeekInPeriod(week, period)).length}회</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" className="h-11 w-11 shrink-0" aria-label={`${period.label} 관리`}><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="shadow-none">
                    <DropdownMenuItem className="min-h-11" onSelect={() => manage(() => onEdit(period))}>이름·날짜 수정</DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" disabled={period.is_current} onSelect={() => manage(() => onSetDefault(period))}>공유 기본으로 지정</DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11 text-red-500" disabled={period.is_current} onSelect={() => manage(() => onDelete(period))}>기간 삭제</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>)}
            </div>
            {periods.length === 0 && <p className="py-8 text-center text-sm text-gray-500">새 기간을 시작해 수업 기록을 묶어보세요.</p>}
            {shared && <p className="mt-4 text-xs leading-5 text-gray-500">공유 기본 기간을 삭제하려면 먼저 다른 기간을 기본으로 지정해 주세요.</p>}
          </div>
        </SheetContent>
    </section>
    </Sheet>
  )
}
