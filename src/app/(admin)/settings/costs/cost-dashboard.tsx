'use client'

import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { services, summarize, koreanMonth, snapshotLabel, snapshotValue, type CostEntry, type UsageGroup } from '@/lib/costs/model'

const kindLabels = { actual: '확정 청구액', estimate: '예상 사용액', topup: '충전액', budget: '월 예산' }
const environmentLabels = { production: '운영', development: '개발', test: '테스트' }
const money = (value: number, currency: string) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: currency === 'KRW' ? 0 : 2 }).format(value)
const surface = 'rounded-[20px] bg-[var(--share-card)] p-5'
const selectStyle = 'h-9 rounded-md border bg-background px-3 text-sm'

export function CostDashboard() {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(koreanMonth)
  const [environment, setEnvironment] = useState('production')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [provider, setProvider] = useState('claude')
  const [kind, setKind] = useState('actual')
  const [currency, setCurrency] = useState('USD')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const query = useQuery({
    queryKey: ['costs', month, environment],
    queryFn: async (): Promise<{ entries: CostEntry[]; usage: UsageGroup[]; tracking: boolean }> => {
      const response = await fetch(`/api/admin/costs?month=${month}&environment=${environment}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '비용을 불러오지 못했습니다.')
      return data
    }, retry: false, staleTime: 60_000, refetchOnWindowFocus: true,
    refetchInterval: month === koreanMonth() ? 60_000 : false, refetchIntervalInBackground: false,
  })
  const connections = useQuery({
    queryKey: ['cost-connections', month],
    queryFn: async (): Promise<{ snapshots: { provider: string; amount: number | null; currency: string; metric: string; updated_at: string; status: string }[]; configured: string[] }> => {
      const response = await fetch(`/api/admin/costs/sync?month=${month}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '연결 상태 조회 실패')
      return data
    }, retry: false,
  })
  const providerRefresh = useQuery({
    queryKey: ['cost-provider-refresh', month],
    enabled: month === koreanMonth() && (connections.data?.configured.length ?? 0) > 0,
    queryFn: async ({ signal }): Promise<{ message: string }> => {
      const response = await fetch('/api/admin/costs/sync', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month }) })
      const data = await response.json()
      // Reload saved snapshots even when provider synchronization failed.
      await queryClient.invalidateQueries({ queryKey: ['cost-connections', month] })
      if (!response.ok) throw new Error(data.error || '업체 비용 갱신에 실패했습니다.')
      return data
    }, retry: false, staleTime: 300_000, refetchOnWindowFocus: true,
    refetchInterval: month === koreanMonth() ? 300_000 : false, refetchIntervalInBackground: false,
  })
  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setNotice('')
    try {
      const response = await fetch('/api/admin/costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, kind, currency, amount: Number(amount), note, month, environment }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setNotice('저장했습니다. 같은 업체·기간·환경·통화·종류의 기존 금액은 교체됩니다.')
      setAmount(''); setNote('')
      await query.refetch()
    } catch (error) { setNotice(error instanceof Error ? error.message : '저장에 실패했습니다.') }
    finally { setSaving(false) }
  }
  async function remove(id: string) {
    setSaving(true); setNotice('')
    try {
      const response = await fetch(`/api/admin/costs?id=${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('삭제에 실패했습니다.')
      await query.refetch()
      setNotice('삭제했습니다.')
    } catch (error) { setNotice(error instanceof Error ? error.message : '삭제에 실패했습니다.') }
    finally { setSaving(false) }
  }
  async function sync() {
    setNotice('')
    const result = await providerRefresh.refetch()
    setNotice(result.error?.message ?? result.data?.message ?? '조회 결과가 없습니다.')
  }
  const entries = query.data?.entries ?? []
  return <div className="mx-auto max-w-6xl space-y-5 text-[var(--share-ink)]">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-[23px] font-bold">비용 관리</h1><p className="mt-1 text-sm text-[var(--share-muted)]">업체별 비용과 앱 사용량을 함께 확인합니다. 기간은 한국 시간 기준입니다.</p></div>
      <div className="flex flex-wrap gap-2">
        <Input className="w-40" type="month" aria-label="조회 월" value={month} onChange={e => setMonth(e.target.value)} />
        <select aria-label="환경" className={selectStyle} value={environment} onChange={e => setEnvironment(e.target.value)}>{Object.entries(environmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <Button variant="outline" onClick={() => { void query.refetch(); void sync() }}>새로고침</Button>
      </div>
    </div>
    <p className="text-xs text-[var(--share-muted)]">{month === koreanMonth() ? '화면이 활성화된 동안 사용량은 1분, 업체 비용은 5분마다 자동 갱신합니다.' : '과거 월은 새로고침으로 갱신할 수 있습니다.'} 업체 청구 데이터는 반영이 늦을 수 있으며, GCP는 Google 내보내기 기준입니다.{query.dataUpdatedAt > 0 && <> · 사용량 조회 {new Date(query.dataUpdatedAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}</>}</p>
    <div className="grid gap-3 md:grid-cols-3">{services.filter(service => ['claude', 'naver', 'gcp'].includes(service.id)).sort((a, b) => ['claude', 'naver', 'gcp'].indexOf(a.id) - ['claude', 'naver', 'gcp'].indexOf(b.id)).map(service => {
      const snapshot = connections.data?.snapshots.find(row => row.provider === service.id && row.metric === 'monthly_cost')
      return <section key={service.id} className={surface} aria-label={service.name + ' 조회액'}>
        <h2 className="text-sm font-semibold">{service.name}</h2>
        <p className="mt-2 text-xl font-bold tabular-nums">{snapshot?.amount != null ? snapshotValue(snapshot.amount, snapshot.currency) : connections.isPending ? '불러오는 중…' : '조회값 없음'}</p>
        <p className="mt-2 text-xs text-[var(--share-muted)]">업체 월 조회액 · {snapshot?.status === 'ok' ? '조회 성공' : snapshot?.amount != null ? '갱신 실패 · 이전 값' : service.id === 'gcp' ? '청구 데이터 반영·연결 확인 필요' : '연결·청구서 반영 확인 필요'}</p>
        {snapshot && <p className="mt-1 text-xs text-[var(--share-muted)]">{new Date(snapshot.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>}
      </section>
    })}</div>
    {query.isPending && <p role="status">비용 데이터를 불러오는 중입니다.</p>}
    {query.error && <p role="alert" className="rounded-xl bg-[var(--share-red-bg)] p-4 text-sm text-[var(--share-red)]">{query.error.message}</p>}
    <section className={surface}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[15px] font-extrabold">서비스별 비용·연결</h2><Button disabled={providerRefresh.isFetching} variant="outline" onClick={() => void sync()}>{providerRefresh.isFetching ? '조회 중…' : '업체 데이터 동기화'}</Button></div>
      <p className="mt-2 text-xs text-[var(--share-muted)]">업체 조회값은 계정 전체 기준이며 아래 등록 비용 합계에 자동 포함하지 않습니다. 앱 사용액과 범위를 확인한 뒤 등록하세요.</p>
      {providerRefresh.error && <p role="alert" className="mt-2 text-sm text-[var(--share-red)]">{providerRefresh.error.message}</p>}
      {providerRefresh.data?.message && <p className="mt-2 text-xs text-[var(--share-muted)]">{providerRefresh.data.message}</p>}
      {connections.error && <p role="alert" className="mt-2 text-sm text-[var(--share-red)]">{connections.error.message}</p>}
      <div className="mt-4 divide-y divide-[var(--share-line)]">{services.map(service => {
        const rows = entries.filter(e => e.provider === service.id && (e.kind === 'actual' || e.kind === 'estimate'))
        const snapshots = connections.data?.snapshots.filter(s => s.provider === service.id) ?? []
        return <div key={service.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
          <div><p className="font-semibold">{service.name}</p><p className="text-xs text-[var(--share-muted)]">{service.role}</p>{service.url && <a className="text-xs text-[var(--share-blue)] underline" href={service.url} target="_blank" rel="noreferrer">업체 콘솔 열기</a>}</div>
          <div className="text-sm md:text-right">{rows.length ? rows.map(row => <p key={row.id}>{kindLabels[row.kind]} {money(row.amount, row.currency)}</p>) : <p className="text-[var(--share-muted)]">비용 미등록</p>}
            <p className="text-xs text-[var(--share-muted)]">{connections.data?.configured.includes(service.id) ? '자동 조회 설정됨' : '수동 관리 · 자동 조회 미연결'}</p>
            {snapshots.map(snapshot => <p key={snapshot.metric} className="mt-1 text-xs">{snapshotLabel(snapshot.metric)}: {snapshotValue(snapshot.amount, snapshot.currency)} · {snapshot.status === 'ok' ? '조회 성공' : snapshot.amount === null ? '조회 실패·청구서 미발행 또는 설정 확인' : '갱신 실패 · 이전 값'}<br /><span className="text-[var(--share-muted)]">{new Date(snapshot.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span></p>)}
          </div>
        </div>
      })}</div>
    </section>
    {query.data && <>
      <div className="grid gap-3 md:grid-cols-2">{summarize(entries).map(total => <section key={total.currency} className={surface}>
        <h2 className="text-sm font-semibold">{total.currency} 등록 비용 합계</h2>
        <p className="mt-2 text-xl font-bold tabular-nums">{entries.some(e => e.currency === total.currency && (e.kind === 'actual' || e.kind === 'estimate')) ? money(total.total, total.currency) : '미등록'}</p>
        <p className="mt-2 text-xs text-[var(--share-muted)]">확정 {money(total.actual, total.currency)} · 예상 {money(total.estimate, total.currency)} · 충전액 합계 제외</p>
        <p className="mt-2 text-sm">예산 {total.budget ? money(total.budget, total.currency) : '미설정'}{total.budget > 0 && <span className={total.total > total.budget ? 'text-[var(--share-red)]' : ''}> · {Math.round(total.total / total.budget * 100)}% 사용{total.total > total.budget ? ' · 예산 초과' : ''}</span>}</p>
      </section>)}</div>
      <p className="text-xs text-[var(--share-muted)]">등록된 업체만 합산합니다. 같은 업체·통화의 확정 청구액이 있으면 예상액은 제외합니다. 통화는 합산하지 않습니다.</p>
    </>}
    <section className={surface}><h2 className="text-[15px] font-extrabold">비용·예산 등록</h2>
      <p className="mt-2 text-xs text-[var(--share-muted)]">선택한 월·환경의 업체별 총액을 입력합니다. 같은 항목은 덮어씁니다. 충전액과 실제 사용액은 별도로 관리하세요.</p>
      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs">업체<select className={selectStyle} value={provider} onChange={e => setProvider(e.target.value)}>{services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="grid gap-1 text-xs">종류<select className={selectStyle} value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-xs">통화<select className={selectStyle} value={currency} onChange={e => setCurrency(e.target.value)}><option>USD</option><option>KRW</option></select></label>
        <label className="grid gap-1 text-xs">금액<Input className="w-36" type="number" required min="0" max="1000000000000" step="0.000001" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="grid gap-1 text-xs">메모<Input maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="청구서 기준·갱신일 등" /></label>
        <Button type="submit" disabled={saving || !query.data}>{saving ? '저장 중…' : '저장'}</Button>
      </form>
      {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
      <div className="mt-4 space-y-2">{entries.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--share-line)] pt-2 text-sm"><div>{services.find(s => s.id === entry.provider)?.name} · {kindLabels[entry.kind]} · {money(entry.amount, entry.currency)}<span className="ml-2 text-xs text-[var(--share-muted)]">{entry.note}</span></div><Button variant="ghost" size="sm" disabled={saving} onClick={() => void remove(entry.id)} aria-label={`${entry.provider} ${kindLabels[entry.kind]} 삭제`}>삭제</Button></div>)}</div>
    </section>
    <section className={surface}><h2 className="text-[15px] font-extrabold">기능별 기록 사용량</h2>
      <p className="mt-2 text-xs text-[var(--share-muted)]">{query.data?.tracking ? '사용량 기록 활성화' : '사용량 기록 비활성 · SQL 적용 후 COST_TRACKING_ENABLED 설정 필요'} · 활성화 이후 기록만 표시합니다. 문자 접수 건수는 최종 과금 건수와 다를 수 있습니다.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm tabular-nums"><thead><tr><th className="py-2">기능 / 모델</th><th>호출 / 수량</th><th>입력 / 출력 토큰</th><th>캐시 읽기 / 쓰기</th></tr></thead><tbody>{query.data?.usage.map(row => <tr key={`${row.provider}:${row.feature}:${row.model}`} className="border-t border-[var(--share-line)]"><td className="py-3">{row.provider} · {row.feature}<br /><span className="text-xs text-[var(--share-muted)]">{row.model}</span></td><td>{row.calls} / {row.units}</td><td>{row.input_tokens} / {row.output_tokens}</td><td>{row.cache_read_tokens} / {row.cache_write_tokens}</td></tr>)}</tbody></table></div>
      {query.data && !query.data.usage.length && <p className="mt-3 text-sm text-[var(--share-muted)]">이 기간에 기록된 사용량이 없습니다.</p>}
    </section>
  </div>
}
