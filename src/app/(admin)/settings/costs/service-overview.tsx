'use client'

import { services, snapshotValue, type UsageGroup } from '@/lib/costs/model'
import { estimateMoney, estimateUsage } from '@/lib/costs/estimate'
import { reconcileClaude, type ClaudeReport } from '@/lib/costs/claude-report'
import { ProviderUsageDetail } from './provider-usage-detail'
import type { CostSnapshot } from './cost-overview'

const muted = 'text-[var(--share-muted)]'
const count = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
const order = ['claude', 'naver', 'gcp', 'supabase', 'solapi', 'vercel']
export function ServiceOverview({ usage, snapshots, report, tail, selected, onSelect, loading, failed, environment }: {
  usage: UsageGroup[]; snapshots: CostSnapshot[]; report: ClaudeReport | null; tail: UsageGroup[]; selected: string;
  onSelect: (id: string) => void; loading: boolean; failed: boolean; environment: string;
}) {
  const get = (provider: string, metric: string) => snapshots.find(s => s.provider === provider && s.metric === metric)
  const value = (provider: string, metric: string) => { const s = get(provider, metric); return s?.amount != null ? snapshotValue(s.amount, s.currency) : '집계 대기' }
  const local = (id: string) => usage.filter(s => s.provider === id)
  const rows = order.map(id => {
    const service = services.find(s => s.id === id)!
    const plan = id === 'supabase' ? get(id, 'plan_free') : undefined
    const sms = id === 'solapi' ? get(id, 'sms_succeeded') : undefined
    const automatic = id === 'supabase' ? undefined : get(id, 'monthly_cost')
    const consoleSnapshot = id === 'gcp' ? get(id, 'console_monthly_cost') : undefined
    const snapshot = automatic?.amount != null ? automatic : consoleSnapshot ?? automatic
    const consoleOnly = snapshot?.metric === 'console_monthly_cost'
    const estimate = estimateUsage(usage, id === 'naver' ? 'naver' : 'claude')
    const org = id === 'claude' && report ? reconcileClaude(report, tail) : null
    const orgTokens = report?.models.reduce((n, m) => n + m.input + m.output + m.read + m.write, 0) ?? 0
    const calls = get('gcp', 'worker_executions')
    const usageText = id === 'claude' ? report ? `${count(orgTokens)} 토큰` : '조직 보고서 대기'
      : id === 'naver' ? local(id).length ? `${count(estimate.units)}건 OCR 요청` : '앱 기록 대기'
      : id === 'gcp' ? calls?.amount != null ? `${count(calls.amount)}회 실행${calls.status === 'ok' ? '' : ' · 이전 값'}` : '실행 기록 수집 대기'
      : id === 'supabase' ? `DB ${value(id, `db_bytes_${environment}`)} · Storage ${value(id, `storage_bytes_${environment}`)}`
      : id === 'solapi' ? sms?.amount != null ? `${count(sms.amount)}건 문자 발송 성공${sms.status === 'ok' ? '' : ' · 이전 값'}` : '업체 발송 통계 대기'
      : '웹·API 배포'
    const actual = id === 'supabase' ? '—' : id === 'claude' && report && report.costThrough !== report.start ? snapshotValue(report.reported, 'USD') : snapshot?.amount != null ? snapshotValue(snapshot.amount, snapshot.currency) : '집계 대기'
    const estimated = org ? snapshotValue(org.total, 'USD') : id === 'naver' && estimate.amount != null ? estimateMoney(estimate.amount, 'KRW') : '—'
    const health = id === 'supabase' ? snapshots.filter(s => s.provider === id && (s.metric.startsWith('metrics_') || s.metric === `db_bytes_${environment}`) && s.metric.endsWith(`_${environment}`)) : []
    return { id, service, snapshot, plan, health, usageText, actual, estimated, consoleOnly, partial: org?.partial || ((id === 'claude' || id === 'naver') && estimate.excludedCalls > 0) }
  })
  const current = rows.find(r => r.id === selected) ?? rows[0]
  const totals = ['USD', 'KRW'].map(currency => {
    const known = rows.filter(r => r.snapshot?.amount != null && r.snapshot.currency === currency)
    // Claude's report and snapshot represent the same source; never sum both.
    const total = known.reduce((sum, r) => sum + (r.id === 'claude' && report && report.costThrough !== report.start ? report.reported : r.snapshot!.amount!), 0)
    return { currency, value: known.length ? snapshotValue(total, currency) : '집계 대기', providers: known.length }
  })
  return <section aria-label="서비스 사용량과 비용" className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">
      {totals.map(t => <div key={t.currency} className="rounded-[20px] bg-[var(--share-card)] p-5"><p className={`text-xs ${muted}`}>업체 조회액 · {t.currency}</p><p className="mt-2 text-xl font-bold tabular-nums">{failed ? '조회 실패' : loading ? '불러오는 중…' : t.value}</p><p className={`mt-2 text-xs ${muted}`}>{t.providers}개 업체 확인 · 미수신 비용·잔액 제외</p></div>)}
      <div className="rounded-[20px] bg-[var(--share-card)] p-5"><p className={`text-xs ${muted}`}>월 비용 확인</p><p className="mt-2 text-xl font-bold tabular-nums">{rows.filter(r => r.snapshot?.amount != null).length} / {rows.filter(r => r.id !== 'supabase').length}</p><p className={`mt-2 text-xs ${muted}`}>Supabase는 사용량만 표시</p></div>
    </div>
    <div className="overflow-hidden rounded-[20px] border border-[var(--share-line-strong)]">
      <div className="flex items-center justify-between px-5 py-4"><h2 className="text-[15px] font-extrabold">서비스 현황</h2><span className={`text-xs ${muted}`}>서비스를 선택해 상세 확인</span></div>
      <div className="overflow-x-auto"><table aria-label="서비스별 사용량과 비용" className="w-full min-w-[680px] text-left text-sm"><thead className={`bg-[var(--share-card)] text-xs ${muted}`}><tr>{['서비스', '사용량', '업체 조회액', '현재 예상', '상태'].map(label => <th key={label} className="px-5 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className={`border-t border-[var(--share-line)] ${selected === row.id ? 'bg-[var(--share-blue-bg)]' : ''}`}>
        <th className="px-5 py-4"><button type="button" aria-label={row.service.name} aria-pressed={selected === row.id} onClick={() => onSelect(row.id)} className="text-left outline-offset-4"><span className={selected === row.id ? 'text-[var(--share-blue)]' : ''}>{row.service.name}</span>{row.plan && <span className={`ml-2 text-[11px] font-normal ${muted}`}>Free</span>}<span className={`mt-1 block text-[11px] font-normal ${muted}`}>{row.service.role}</span></button></th>
        <td className="max-w-64 px-5 py-4 text-xs tabular-nums">{failed ? '조회 실패' : row.usageText}</td><td className="px-5 py-4 font-semibold tabular-nums">{row.actual}</td><td className="px-5 py-4 tabular-nums">{row.estimated}{row.partial && <span className={`block text-[11px] ${muted}`}>일부 계산</span>}</td><td className={`px-5 py-4 text-xs ${muted}`}>{row.id === 'supabase' ? row.health.some(s => s.status === 'error') ? '사용량 갱신 확인 필요' : row.health.length ? '사용량 자동 수집' : '사용량 수집 대기' : row.consoleOnly ? '콘솔 확인 · 자동 수신 대기' : row.snapshot?.status === 'ok' ? '수신됨' : row.snapshot?.amount != null ? '이전 값 · 갱신 실패' : '비용 수신 대기'}</td>
      </tr>)}</tbody></table></div>
    </div>
    {selected !== 'all' && <section aria-label={current.service.name + ' 상세'} className="rounded-[20px] bg-[var(--share-card)] p-5">
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-[15px] font-extrabold">{current.service.name} 상세</h2><p className={`mt-1 text-xs ${muted}`}>{current.usageText}</p></div><a href={current.service.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--share-blue)]">업체 콘솔 ↗</a></div>
      {selected !== 'supabase' && <div className="mt-5 grid gap-4 sm:grid-cols-3"><div><p className={`text-xs ${muted}`}>업체 월 조회액</p><p className="mt-1 text-xl font-bold tabular-nums">{current.actual}</p></div><div><p className={`text-xs ${muted}`}>현재 예상 · 청구 전</p><p className="mt-1 text-xl font-bold tabular-nums">{current.estimated}</p></div><div><p className={`text-xs ${muted}`}>조회·콘솔 확인 시각 · 한국 시간</p><p className="mt-2 text-sm tabular-nums">{(current.snapshot?.amount != null || current.plan) ? new Date((current.snapshot ?? current.plan)!.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '수신 대기'}</p></div></div>}
      <p className={`mt-4 border-t border-[var(--share-line-strong)] pt-4 text-xs leading-relaxed ${muted}`}>{selected === 'claude' ? '조직 전체 UTC 월 누계입니다. 업체 조회액에 이후 토큰 예상액을 더하며 같은 시간의 앱 기록은 중복 합산하지 않습니다.' : selected === 'gcp' ? '실행 횟수와 실행 시간은 Cloud Run에 보존된 기록 중 선택한 월에 시작한 실행 기준이며 삭제된 과거 기록은 제외됩니다. 비용은 BigQuery 청구 데이터입니다. 실행 시간은 과금 CPU 시간이 아니며, 실패한 실행도 자원을 사용합니다. 비용 수신 대기는 0원을 의미하지 않습니다. 콘솔 확인액은 수동 확인 시점의 값이며 자동 청구 데이터가 도착하면 대체됩니다.' : selected === 'naver' ? '앱 기록 기준 예상액은 General OCR 요청당 3원이며 무료분·할인·부가세 차감 전입니다. 계정 전체 청구액과 범위가 다를 수 있습니다.' : selected === 'solapi' ? '한국 시간 선택 월의 계정 전체 업체 통계입니다. 문자 발송 성공 건수는 SMS·LMS·MMS를 합산합니다. 사용 금액은 예치금·캐시 사용액이며 포인트는 별도로 표시합니다. 업체 반환값의 환불액을 다시 차감하지 않습니다. 앱 외 발송도 포함될 수 있습니다.' : selected === 'supabase' ? '선택한 환경의 현재 DB·Storage 사용량과 DB 상태를 자동 수집합니다. Free 플랜에서는 사용량 중심으로 확인합니다.' : '업체 비용 보고서를 연결하면 월 조회액을 표시합니다. 조회값이 없을 때 0원으로 간주하지 않습니다.'}</p>
      {selected === 'gcp' && <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['worker_succeeded', '성공'], ['worker_failed', '실패'], ['worker_running', '진행 중'], ['worker_wall_seconds', '실행 시간 합계']].map(([metric, label]) => <div key={metric}><dt className={`text-xs ${muted}`}>{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value('gcp', metric)}</dd></div>)}</dl>}
      <ProviderUsageDetail provider={selected} snapshots={snapshots} environment={environment} />
    </section>}
  </section>
}
