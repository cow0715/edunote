import { quotaUsage, SUPABASE_FREE_DB_BYTES, SUPABASE_FREE_STORAGE_BYTES } from '@/lib/costs/supabase-quota'
import type { CostSnapshot } from './cost-overview'

const muted = 'text-[var(--share-muted)]'
const mb = (bytes: number) => `${(bytes / 1_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB`
export function SupabaseQuota({ snapshots, environment }: { snapshots: CostSnapshot[]; environment: string }) {
  const items = [
    { metric: 'db_bytes', label: 'DB', limit: SUPABASE_FREE_DB_BYTES, allowance: '500 MB · 프로젝트별', partial: false },
    { metric: 'storage_bytes', label: 'Storage', limit: SUPABASE_FREE_STORAGE_BYTES, allowance: '1 GB · 조직 공유', partial: true },
  ].map(item => {
    const snapshot = snapshots.find(s => s.provider === 'supabase' && s.metric === `${item.metric}_${environment}`)
    return { ...item, snapshot, usage: quotaUsage(snapshot?.amount, item.limit) }
  })
  const warnings = items.filter(item => item.usage?.warning)
  return <section aria-label="Supabase 무료 한도" className="rounded-[20px] bg-[var(--share-card)] p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[15px] font-extrabold">Supabase 무료 한도</h2><span className={`text-xs ${muted}`}>마지막 수집값 기준 · {environment === 'production' ? '운영' : environment === 'development' ? '개발' : '테스트'}</span></div>
    {warnings.length > 0 && <p role="alert" className="mt-3 text-sm font-semibold text-[var(--share-red)]">{warnings.map(item => `${item.label} ${item.usage!.percent}% · ${item.usage!.level}${item.snapshot?.status !== 'ok' ? ' (이전 값)' : ''}`).join(' / ')} — 용량 정리가 필요합니다.</p>}
    <div className="mt-4 grid gap-5 sm:grid-cols-2">{items.map(item => <div key={item.metric}>
      <div className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold">{item.label}</span><span className={`text-xs ${item.usage?.warning ? 'font-semibold text-[var(--share-red)]' : muted}`}>{!item.usage ? '수집 대기' : item.snapshot?.status !== 'ok' ? '갱신 실패 · 이전 값' : item.usage.warning ? item.usage.level : item.partial ? '프로젝트 사용분' : item.usage.level}</span></div>
      <p className="mt-2 font-semibold tabular-nums">{item.usage ? `${mb(item.snapshot!.amount!)} / ${item.allowance} · ${item.usage.percent}%` : `— / ${item.allowance}`}</p>
      <div role="progressbar" aria-label={`${item.label} 무료 한도 대비 ${item.partial ? '프로젝트 사용분' : '사용률'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.usage?.bar} aria-valuetext={item.usage ? `${item.usage.percent}%${item.partial ? ' 이상, 다른 프로젝트 제외' : ''}` : '사용량 수집 대기'} className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--share-box)]"><div className={`h-full rounded-full ${item.usage?.warning ? 'bg-[var(--share-red)]' : 'bg-[var(--share-muted)]'}`} style={{ width: `${item.usage?.bar ?? 0}%` }} /></div>
      <p className={`mt-2 text-xs ${muted}`}>{item.usage && !item.partial ? `${mb(item.usage.remaining)} 남음 · ` : ''}{item.partial ? '선택 프로젝트만 포함 · 조직 전체 잔여량은 확인 필요' : '현재 DB 실측값으로 계산한 참고 비율'}</p>
      {item.snapshot && <p className={`mt-1 text-[11px] ${muted}`}>수집 {new Date(item.snapshot.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>}
    </div>)}</div>
    <p className={`mt-4 text-xs ${muted}`}>화면 안내 기준: 80% 주의 · 90% 임박 · 100% 초과. 전송량·MAU 등 미수집 항목은 포함하지 않습니다. <a href="https://supabase.com/dashboard/org/kxjbrdpaeovoocubhdsc/usage" target="_blank" rel="noreferrer" className="text-[var(--share-blue)]">조직 전체 사용량 ↗</a></p>
  </section>
}
