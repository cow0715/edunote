import { snapshotValue } from '@/lib/costs/model'
import type { CostSnapshot } from './cost-overview'

export function ProviderUsageDetail({ provider, snapshots, environment }: { provider: string; snapshots: CostSnapshot[]; environment: string }) {
  if (provider !== 'solapi' && provider !== 'supabase') return null
  const get = (metric: string) => snapshots.find(s => s.provider === provider && s.metric === metric)
  const value = (metric: string) => { const s = get(metric); return s?.amount != null ? snapshotValue(s.amount, s.currency) : '수집 대기' }
  const time = (metric: string) => { const s = get(metric); return s ? new Date(s.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '확인 기록 없음' }
  const muted = 'text-[var(--share-muted)]'
  const facts = provider === 'solapi' ? [
    ['message_total', '전체 메시지 발송'], ['message_succeeded', '전체 성공'], ['message_failed', '전체 실패'],
    ['sms_count', 'SMS 성공'], ['lms_count', 'LMS 성공'], ['mms_count', 'MMS 성공'],
    ['deposit_usage', '예치금 사용액'], ['cash_usage', '캐시 사용액'], ['point_usage', '포인트 사용'],
    ['cash_refund', '환불액 · 참고'],
  ] : [[`db_bytes_${environment}`, '현재 DB 크기'], [`storage_bytes_${environment}`, '현재 Storage 크기'], [`files_${environment}`, '현재 저장 파일']]
  return <div className="mt-5 space-y-5">
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">{facts.map(([metric, label]) => <div key={metric}><dt className={`text-xs ${muted}`}>{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value(metric)}{get(metric)?.status === 'error' && <span className={`ml-1 text-xs font-normal ${muted}`}>이전 값 · 갱신 실패</span>}</dd></div>)}</dl>
    {provider === 'solapi' ? <p className={`text-xs ${muted}`}>업체 통계 수집 {time('monthly_cost')} · 미완료 발송은 성공·실패에 아직 포함되지 않을 수 있습니다. 환불 참고액과 포인트를 사용 금액에 중복 합산하지 않습니다.</p> : <>
      <div className="border-t border-[var(--share-line-strong)] pt-4"><h3 className="text-sm font-semibold">조직 전체 · 콘솔 확인 내역</h3><p className={`mt-1 text-xs ${muted}`}>청구주기 {value('console_cycle_start')} ~ {value('console_cycle_end')} · 달력 월과 다릅니다.</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{[
          ['console_egress_gb', 'console_egress_quota_gb', '전송량'], ['console_cached_egress_gb', 'console_cached_egress_quota_gb', '캐시 전송량'],
          ['console_storage_gb', 'console_storage_quota_gb', '평균 Storage'], ['console_mau', 'console_mau_quota', '활성 사용자'],
        ].map(([metric, quota, label]) => <div key={metric}><dt className={`text-xs ${muted}`}>{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{value(metric)}<span className={`block text-xs font-normal ${muted}`}>무료 한도 {value(quota)}</span></dd></div>)}</dl>
        <p className={`mt-4 text-xs ${muted}`}>최근 청구서 {value('invoice_last_issued_at')} · {value('invoice_last_amount')} · 이번 달 사용액 합계에서 제외</p>
        <p className={`mt-2 text-xs ${muted}`}>콘솔 수동 확인 {time('plan_free')} · DB 크기는 청구용 최대치와 현재 실측값이 다를 수 있습니다.</p>
        <a href="https://supabase.com/dashboard/org/kxjbrdpaeovoocubhdsc/usage" target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-[var(--share-blue)]">최신 조직 사용량·청구서 확인 ↗</a>
      </div>
    </>}
  </div>
}
