import { quotaUsage, SUPABASE_FREE_DB_BYTES, SUPABASE_FREE_STORAGE_BYTES } from '@/lib/costs/supabase-quota'
import { Database, HardDrive, ArrowUpRight, Zap, Users } from 'lucide-react'
import type { CostSnapshot } from './cost-overview'

const muted = 'text-[var(--share-muted)]'
const mb = (bytes: number) => `${(bytes / 1_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB`
export function SupabaseQuota({ snapshots, environment }: { snapshots: CostSnapshot[]; environment: string }) {
  const organization = snapshots.find(s => s.provider === 'supabase' && s.metric === 'storage_bytes_organization')
  const items = [
    { tone: 'blue', icon: Database, metric: 'db_bytes', label: 'DB', limit: SUPABASE_FREE_DB_BYTES, allowance: '500 MB · 프로젝트별', partial: false },
    { tone: 'purple', icon: HardDrive, metric: 'storage_bytes', label: 'Storage', limit: SUPABASE_FREE_STORAGE_BYTES, allowance: '1 GB · 조직 공유', partial: true },
  ].map(item => {
    const project = snapshots.find(s => s.provider === 'supabase' && s.metric === `${item.metric}_${environment}`)
    const snapshot = item.metric === 'storage_bytes' && organization?.amount != null ? organization : project
    return { ...item, partial: item.partial && organization?.amount == null, snapshot, usage: quotaUsage(snapshot?.amount, item.limit) }
  })
  const warnings = items.filter(item => item.usage?.warning)
  const monthly = [
    { tone: 'blue', icon: ArrowUpRight, metric: 'console_egress_gb', label: '일반 전송량', limit: 5, unit: 'GB' },
    { tone: 'teal', icon: Zap, metric: 'console_cached_egress_gb', label: '캐시 전송량', limit: 5, unit: 'GB' },
    { tone: 'purple', icon: Users, metric: 'console_mau', label: '월간 활성 사용자', limit: 50_000, unit: '명' },
  ].map(item => {
    const snapshot = snapshots.find(s => s.provider === 'supabase' && s.metric === item.metric)
    return { ...item, snapshot, usage: quotaUsage(snapshot?.amount, item.limit) }
  })
  const cycle = (metric: string) => {
    const value = snapshots.find(s => s.provider === 'supabase' && s.metric === metric)?.amount
    return value != null && Number.isFinite(value) ? new Date(value * 1000).toLocaleDateString('ko-KR', { timeZone: 'UTC' }) : null
  }
  const start = cycle('console_cycle_start'), end = cycle('console_cycle_end')
  return <section aria-label="Supabase 무료 한도" className="rounded-[20px] bg-[var(--share-card)] p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[15px] font-extrabold">Supabase 무료 한도</h2><span className={`text-xs ${muted}`}>마지막 수집값 기준 · {environment === 'production' ? '운영' : environment === 'development' ? '개발' : '테스트'}</span></div>
    {warnings.length > 0 && <p role="alert" className="mt-3 text-sm font-semibold text-[var(--share-red)]">{warnings.map(item => `${item.label} ${item.usage!.percent}% · ${item.usage!.level}${item.snapshot?.status !== 'ok' ? ' (이전 값)' : ''}`).join(' / ')} — 용량 정리가 필요합니다.</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{items.map(item => <div key={item.metric} data-cost-tone={item.tone} className="cost-tile">
      <div className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-3 font-semibold"><span className="cost-icon"><item.icon size={19} aria-hidden="true" /></span>{item.label}</span><span className={`text-xs ${item.usage?.warning ? 'font-semibold text-[var(--share-red)]' : muted}`}>{!item.usage ? '수집 대기' : item.snapshot?.status !== 'ok' ? '갱신 실패 · 이전 값' : item.usage.warning ? item.usage.level : item.partial ? organization?.status === 'error' ? '합산 수집 실패 · 일부 값' : '프로젝트 사용분' : item.usage.level}</span></div>
      <p className="mt-4 text-lg font-bold tracking-tight tabular-nums sm:text-xl">{item.usage ? `${mb(item.snapshot!.amount!)} / ${item.allowance} · ${item.usage.percent}%` : `— / ${item.allowance}`}</p>
      <div role="progressbar" aria-label={`${item.label} 무료 한도 대비 ${item.partial ? '프로젝트 사용분' : '사용률'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.usage?.bar} aria-valuetext={item.usage ? `${item.usage.percent}%${item.partial ? ' 이상, 다른 프로젝트 제외' : ''}` : '사용량 수집 대기'} className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--share-box)]"><div className={`h-full rounded-full ${item.usage?.warning ? 'bg-[var(--share-red)]' : 'cost-meter'}`} style={{ width: `${item.usage?.bar ?? 0}%` }} /></div>
      <p className={`mt-2 text-xs ${muted}`}>{item.usage && !item.partial ? `${mb(item.usage.remaining)} 남음 · ` : ''}{item.partial ? '선택 프로젝트만 포함 · 조직 전체 잔여량은 확인 필요' : item.metric === 'storage_bytes' ? '운영·개발 합산 · 현재 실측값' : '현재 DB 실측값으로 계산한 참고 비율'}</p>
      {item.metric === 'storage_bytes' && <p className={`mt-1 text-xs tabular-nums ${muted}`}>{['production', 'development'].map(env => { const source = snapshots.find(s => s.provider === 'supabase' && s.metric === `storage_bytes_${env}`); return `${env === 'production' ? '운영' : '개발'} ${source?.amount != null ? mb(source.amount) : '미수집'}${source?.status === 'error' ? ' (이전 값)' : ''}` }).join(' + ')}</p>}
      {item.snapshot && <p className={`mt-1 text-[11px] ${muted}`}>수집 {new Date(item.snapshot.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>}
    </div>)}</div>
    <div className="mt-5 border-t border-[var(--share-line)] pt-4">
      <h3 className="text-sm font-semibold">조직 월간 사용량</h3>
      <p className={`mt-1 text-xs ${muted}`}>{start && end ? `사용 기간 ${start} ~ ${end} (종료일 제외) · ` : ''}콘솔 확인값 · 자동 갱신 미연결</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">{monthly.map(item => <div key={item.metric} data-cost-tone={item.tone} className="cost-tile">
        <div className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-3 font-semibold"><span className="cost-icon"><item.icon size={19} aria-hidden="true" /></span>{item.label}</span><span className={`text-xs ${item.usage?.warning ? 'text-[var(--share-red)]' : muted}`}>{item.usage?.warning ? `${item.usage.level} · 확인값` : '콘솔 확인값'}</span></div>
        <p className="mt-4 text-lg font-bold tracking-tight tabular-nums sm:text-xl">{item.usage ? `${item.snapshot!.amount!.toLocaleString('ko-KR', { maximumFractionDigits: 3 })} / ${item.limit.toLocaleString('ko-KR')} ${item.unit} · ${item.snapshot!.amount! > 0 && item.usage.percent === 0 ? '0.1% 미만' : `${item.usage.percent}%`}` : `— / ${item.limit.toLocaleString('ko-KR')} ${item.unit}`}</p>
        <div role="progressbar" aria-label={`${item.label} 무료 한도 대비 사용률 (콘솔 확인값)`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.usage?.bar} aria-valuetext={item.usage ? `${item.snapshot!.amount} ${item.unit}, 확인 시점 ${item.usage.percent}%` : '미수집'} className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--share-box)]"><div className={`h-full rounded-full ${item.usage?.warning ? 'bg-[var(--share-red)]' : 'cost-meter'}`} style={{ width: `${item.usage?.bar ?? 0}%` }} /></div>
        <p className={`mt-2 text-xs ${muted}`}>{item.snapshot ? `확인 ${new Date(item.snapshot.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}${item.snapshot.status !== 'ok' ? ' · 조회 실패, 이전 값' : ''}` : '미수집 · 0 사용으로 계산하지 않음'}</p>
      </div>)}</div>
      <p className={`mt-3 text-xs ${muted}`}>운영·개발 조직 합계입니다. 전송량 두 종류는 각각 별도 한도이며, MAU는 로그인·토큰 갱신한 고유 사용자 수입니다. 현재 값으로 실시간 잔여량을 보장하지 않습니다.</p>
    </div>
    <p className={`mt-4 text-xs ${muted}`}>화면 안내 기준: 80% 주의 · 90% 임박 · 100% 초과. <a href="https://supabase.com/dashboard/org/kxjbrdpaeovoocubhdsc/usage" target="_blank" rel="noreferrer" className="text-[var(--share-blue)]">조직 전체 사용량 확인 ↗</a></p>
  </section>
}
