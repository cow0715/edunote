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
  const [view, setView] = useState('result')
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
  const holds = (recovery ? recoveryHolds : pending).filter((q) => !keys.has(q.key))
  const current = holds.find((q) => q.key === selected) || holds[0]
  const materialUrl = `/exam-bank?tab=list&material=${resolvedBankId}`
  const source = current ? `/api/book-pdf/${documentId}/source?page=${current.page}` : ''
  return <section className="min-w-0 space-y-4 rounded-[20px] bg-muted p-4 sm:p-5 [&_button]:min-h-11 [&_button]:shadow-none" aria-label="현재 등록 결과">
    <div className="space-y-2"><h3 className="text-lg font-bold">{saved === null ? '저장 결과를 확인하고 있습니다' : saved > 0 ? `${saved}문항을 문제은행에서 사용할 수 있어요` : '아직 문제은행에 저장된 문항이 없어요'}</h3><p className="text-sm text-muted-foreground">{remaining === null ? '전체 수량과 저장된 결과를 확인하고 있습니다.' : remaining === 0 ? '전체 문항이 저장되어 있습니다.' : `${total}문항 중 ${saved}문항 저장 · ${remaining}문항 ${status === 'processing' ? '처리 중 또는 확인 필요' : '미저장'}`}</p></div>
    {query.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{query.error.message} 미저장 0문항으로 판단하지 않습니다.</p><Button variant="outline" onClick={() => void query.refetch()}>저장 결과 다시 확인</Button></div>}
    <div className="flex flex-wrap gap-2" aria-label="등록 결과 보기">{[['result', '저장 결과'], ['held', `확인할 문항${remaining === null ? '' : ` ${remaining}`}`], ['cost', '비용 내역']].map(([value, label]) => <Button key={value} variant={view === value ? 'secondary' : 'ghost'} aria-pressed={view === value} onClick={() => setView(value)}>{label}</Button>)}</div>
    {view === 'result' && <div className="space-y-3"><p className="text-sm leading-7">저장된 문제의 지문·선지·정답·해설은 자료 목록에서 확인할 수 있습니다. 이 화면에서는 등록 결과와 미저장 사유를 확인하세요.</p>{!!saved && resolvedBankId && <Button asChild variant="outline"><a href={materialUrl}>저장된 {saved}문항 보기</a></Button>}{remaining !== null && remaining > 0 && <p className="text-sm">{status === 'processing' ? '처리가 진행 중입니다. 완료된 문항 수만 표시합니다.' : '미저장 문항은 사용할 수 없습니다. 확인할 문항에서 이유와 원본을 확인하세요.'}</p>}</div>}
    {view === 'held' && <div className="space-y-3">
      {saved === null ? <p className="text-sm">저장 결과를 확인한 뒤 미저장 목록을 표시합니다.</p> : remaining === 0 ? <p className="text-sm">미저장 문항이 없습니다.</p> : <>
        {recovery && <p className="text-xs text-muted-foreground">2026년 10월 원본 대조 기록입니다. 이후 저장된 문항은 이 목록에서 제외합니다.</p>}
        <div className="flex flex-wrap gap-2">{holds.map((q) => <Button key={q.key} variant={current?.key === q.key ? 'secondary' : 'outline'} aria-pressed={current?.key === q.key} onClick={() => setSelected(q.key)}>{q.label}</Button>)}</div>
        {current && <div className="space-y-3 rounded-xl bg-background p-4"><h4 className="font-semibold">{current.label} · PDF {current.page}쪽</h4><p className="text-sm leading-7">{current.reason}</p><a href={source} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline">원본 PDF 새 창에서 보기</a><iframe key={current.key} title={`${current.label} 원본 PDF`} src={source} loading="lazy" className="h-[55dvh] w-full rounded-xl border" /></div>}
        {(!holds.length || (remaining !== null && remaining > holds.length)) && <p className="text-sm text-muted-foreground">이 목록에 없는 미저장 문항은 아래 전체 처리 내역에서 확인할 수 있습니다. 원인이 확인되지 않은 문항을 유료 처리 대상으로 단정하지 않습니다.</p>}
        <p className="text-sm text-muted-foreground">이 화면을 여는 것만으로 재처리하지 않습니다. 유료 처리가 필요하면 실행 전에 예상 비용을 확인해야 합니다.</p>
      </>}
    </div>}
    {view === 'cost' && <div className="space-y-3 text-sm leading-7">{recovery ? <><h4 className="text-lg font-bold">이전 복구의 추가 AI 비용 $0</h4><p>기존 응답과 원본을 대조해 78문항을 추가 저장한 복구 기록입니다. PDF 재업로드나 작업 재개는 하지 않았습니다.</p><dl><dt>이 교재의 이전 Batch 사용액</dt><dd className="font-semibold">$4.56</dd><dt>사용자가 알려주신 이전 전체 지출</dt><dd>약 $30 · 위 $4.56이 포함된 금액으로, 서로 더하지 않습니다.</dd><dt>보류 문항 추가 처리</dt><dd>미집행</dd></dl><p className="text-xs text-muted-foreground">2026년 10월 확인한 복구 기록이며 실시간 청구액이 아닙니다.</p></> : <p>이 교재의 비용을 이 화면에서 확정할 수 없습니다. 묶음 등록은 아래 처리 내역에서 사용액·예약액·상한을 확인하고, 전체 비용은 비용 관리에서 확인하세요.</p>}<a className="inline-flex min-h-11 items-center underline" href="/settings/costs">비용 관리 열기</a></div>}
  </section>
}
