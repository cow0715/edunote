'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'

type PendingQuestion = { key: string; label: string; page: number; reason: string }
export const RECOVERED_BOOK = { documentId: '20ff4edc-8f08-4f73-a096-e2363a2f166b', bankId: 'f5c4b658-42f6-42ca-9fd6-1699fa3a03f6' }
// Original-PDF review evidence from the October recovery. Saved keys override this historical record.
const recoveryHolds: PendingQuestion[] = [
  { key: 'reading:mini_test:2:8', label: 'Mini Test 2회 8번', page: 71, reason: '문제를 푸는 데 필요한 박물관 도표가 저장 후보에 빠져 있습니다. 원본 도표를 복원하고 선지와 대조해야 합니다.' },
  { key: 'reading:mini_test:3:8', label: 'Mini Test 3회 8번', page: 98, reason: '국가별 수치를 비교하는 원본 표가 저장 후보에 빠져 있습니다. 표를 복원하고 수치와 선지를 대조해야 합니다.' },
  { key: 'reading:mini_test:3:13', label: 'Mini Test 3회 13번', page: 103, reason: '원본 PDF에 밑줄 번호 ③이 두 번 나오고 ④가 없습니다. 인쇄된 정답은 ②이며, 번호 수정 근거와 문항 구조를 확인해야 합니다.' },
  { key: 'reading:mini_test:3:20', label: 'Mini Test 3회 20번', page: 110, reason: '문단 순서를 묻는 문제인데 원본에 (B) 문단 시작 표시가 없습니다. 문단 경계를 확인할 근거가 필요합니다.' },
]

export function BookProcessingSummary({ documentId, bankId, total, status, pending = [] }: {
  documentId: string; bankId: string | null; total: number | null; status: 'processing' | 'review' | 'published'; pending?: PendingQuestion[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const recovery = documentId === RECOVERED_BOOK.documentId
  const resolvedBankId = bankId || (recovery ? RECOVERED_BOOK.bankId : null)
  const query = useQuery<{ source_key?: string | null }[]>({
    queryKey: ['exam-bank-questions', resolvedBankId], enabled: !!resolvedBankId,
    queryFn: async () => {
      const response = await fetch(`/api/exam-bank/${resolvedBankId}/questions`)
      if (!response.ok) throw Error('저장된 문항 수를 확인하지 못했습니다.')
      const data: unknown = await response.json()
      if (!Array.isArray(data)) throw Error('저장된 문항 정보를 확인하지 못했습니다.')
      return data
    },
    refetchInterval: status === 'processing' ? 15_000 : false,
  })
  const saved = !resolvedBankId ? 0 : query.data?.length ?? null
  const remaining = saved !== null && total !== null ? Math.max(0, total - saved) : null
  const keys = new Set(query.data?.map((q) => q.source_key))
  const historical = recovery ? recoveryHolds.filter((q) => !pending.some((entry) => entry.key === q.key)) : []
  const holds = saved === null || remaining === 0 ? [] : [...pending, ...historical].filter((q) => !keys.has(q.key))
  const current = holds.find((q) => q.key === selected)
  const materialUrl = `/exam-bank?tab=list&material=${resolvedBankId}`
  const source = current ? `/api/book-pdf/${documentId}/source?page=${current.page}` : ''
  return <section className="min-w-0 space-y-5" aria-label="현재 등록 결과">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-4">
      <div className="space-y-1"><h3 className="font-semibold">{saved === null ? '저장 결과 확인 중' : saved > 0 ? `${saved}문항 저장됨` : '저장된 문항 없음'}</h3>
        {total !== null && saved !== null && remaining !== null && remaining > 0 && <p className="text-sm text-muted-foreground">{saved === 0 ? `전체 ${total}문항` : `${total}문항 중 ${saved}문항 저장 · ${remaining}문항 ${status === 'processing' ? '처리 중 또는 확인 필요' : '미저장'}`}</p>}
      </div>
      {!!saved && resolvedBankId && <Button asChild variant="outline" className="min-h-11"><a href={materialUrl}>저장된 {saved}문항 보기</a></Button>}
    </div>
    {query.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{query.error.message}</p><Button className="min-h-11" variant="outline" onClick={() => void query.refetch()}>저장 결과 다시 확인</Button></div>}
    {holds.length > 0 && <section aria-label="보류 문항" className="space-y-2">
      <h3 className="text-sm font-semibold">보류 문항 {holds.length}개</h3>
      <ul className="divide-y rounded-xl border px-3">{holds.map(q => <li key={q.key} className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3"><p className="text-sm font-medium">{q.label} <span className="font-normal text-muted-foreground">· PDF {q.page}쪽</span></p>
          <Button variant="ghost" className="min-h-11" aria-expanded={current?.key === q.key} aria-label={`${q.label} 원본 보기`} onClick={() => setSelected(current?.key === q.key ? null : q.key)}>{current?.key === q.key ? '원본 닫기' : '원본 보기'}</Button>
        </div>
        <p className="pb-2 text-sm leading-relaxed text-destructive">{q.reason}</p>
        {current?.key === q.key && <div className="space-y-2 pb-2"><a href={source} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline">원본 PDF 새 창에서 보기</a><iframe title={`${q.label} 원본 PDF`} src={source} loading="lazy" className="h-[55dvh] w-full rounded-lg border" /></div>}
      </li>)}</ul>
    </section>}
    <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">비용 내역</summary>
      <div className="space-y-2 leading-relaxed text-muted-foreground">{recovery ? <><p>이전 복구의 추가 AI 비용 $0 · 이전 Batch $4.56</p><p>2026년 10월 확인한 복구 기록이며 실시간 청구액이 아닙니다.</p></> : <p>파일별 사용액·예약액은 묶음 처리 현황에서 확인할 수 있습니다.</p>}<a className="inline-flex min-h-11 items-center underline" href="/settings/costs">비용 관리 열기</a></div>
    </details>
  </section>
}
