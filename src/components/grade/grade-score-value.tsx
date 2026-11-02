import { cn } from '@/lib/utils'

/** Display only: participation and persisted score remain separate values. */
export function GradeScoreValue({ correct, total, participating, nullLabel = '미채점' }: {
  correct: number | null; total: number; participating?: boolean; nullLabel?: string
}) {
  if (participating === false) return <span className="text-xs font-medium text-muted-foreground">미응시</span>
  if (correct === null) return <span className="text-xs font-medium text-muted-foreground">{nullLabel}</span>
  const rate = total > 0 ? correct / total : null
  return <span className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap tabular-nums"><span className={cn('text-[15px] font-bold', rate !== null && rate < .6 ? 'text-[var(--share-red)]' : rate !== null && rate >= .8 ? 'text-[var(--share-blue)]' : 'text-foreground')}>{correct}</span><span className="text-[11px] font-normal text-muted-foreground">/ {total}</span></span>
}
