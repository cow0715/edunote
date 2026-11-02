'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Review = { snapshot: string; labels?: Record<string, string[]>; completed_units: number; remaining_units: number; spent_usd: number; reserved_usd: number; limit_usd: number }
type Info = { phase: string; review: Review; snapshot_current: string }
export function PilotReview({ jobId }: { jobId: string }) {
  const client = useQueryClient(), [confirmed, setConfirmed] = useState<string | null>(null), [saving, setSaving] = useState(false)
  const query = useQuery<Info>({ queryKey: ['pdf-pilot-review', jobId], queryFn: async () => {
    const response = await fetch(`/api/pdf-import/jobs/${jobId}/pilot-review`)
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '검토 정보 조회 실패')
    return body
  } })
  if (query.error) return <p role="alert" className="mt-2 text-destructive">{query.error.message}</p>
  const info = query.data, review = info?.review
  if (!review) return <p className="mt-2 text-muted-foreground">대표 구간 정보를 불러오는 중…</p>
  const current = info?.phase === 'pilot_review' && info.snapshot_current === review.snapshot
  async function approve() {
    if (!review || !current || confirmed !== review.snapshot) return
    setSaving(true)
    try {
      const response = await fetch(`/api/pdf-import/jobs/${jobId}/pilot-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshot: review.snapshot, confirm: true }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '승인 저장 실패')
      toast.success('승인만 저장했습니다. 전체 처리는 별도로 재개해주세요.')
      await client.invalidateQueries({ queryKey: ['pdf-import-jobs'] })
    } catch (error) { toast.error(error instanceof Error ? error.message : '승인 저장 실패') }
    finally { setSaving(false); await query.refetch() }
  }
  return <div className="mt-3 space-y-2 rounded-lg border p-3" aria-label="대표 구간 검토">
    <p className="font-medium">대표 구간 검증 완료 · 전체 처리 중지</p>
    <p className="text-muted-foreground">원본 대조와 풀이·어휘 보완을 통과한 대표 {review.completed_units}개 지문입니다. 남은 미완료 지문은 {review.remaining_units}개입니다.</p>
    {review.labels && <p className="text-muted-foreground">{Object.values(review.labels).flat().join(' · ')}</p>}
    <p>사용 ${Number(review.spent_usd).toFixed(2)} · 접수 예약 ${Number(review.reserved_usd).toFixed(2)} · 파일 상한 ${Number(review.limit_usd).toFixed(2)}</p>
    <p className="text-xs text-muted-foreground">기존 응답 재사용 비용은 추가되지 않습니다. 전체 예상액은 확정값이 아니며, 새 요청마다 남은 예산을 검사합니다. 승인만으로 작업이 재개되지는 않습니다.</p>
    {!current ? <div><p role="alert">검토 정보가 변경됐습니다. 새로 불러와 확인해주세요.</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>다시 불러오기</Button></div> : <>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={confirmed === review.snapshot} onChange={event => setConfirmed(event.target.checked ? review.snapshot : null)} />대표 구간과 파일 예산을 확인했습니다.</label>
      <Button size="sm" variant="outline" disabled={saving || confirmed !== review.snapshot} onClick={() => void approve()}>{saving ? '저장 중…' : '전체 처리 범위 승인'}</Button>
    </>}
  </div>
}
