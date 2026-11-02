import { cn } from '@/lib/utils'

export function AttendanceStatus({ studentName, status }: { studentName: string; status?: string }) {
  const label = status === 'present' ? '출석' : status === 'late' ? '지각' : status === 'absent' ? '결석' : '미기록'
  return <span aria-label={`${studentName} 출결 상태`} className={cn('inline-flex min-h-9 items-center text-xs font-medium', status === 'absent' ? 'text-[var(--share-red)]' : status === 'late' ? 'text-amber-700' : status === 'present' ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
}
