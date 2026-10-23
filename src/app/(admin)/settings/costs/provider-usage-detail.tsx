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
    {provider === 'supabase' && <p className={`text-xs ${muted}`}>사용량 수집 {time(`db_bytes_${environment}`)}</p>}
    {provider === 'solapi' ? <p className={`text-xs ${muted}`}>업체 통계 수집 {time('monthly_cost')} · 미완료 발송은 성공·실패에 아직 포함되지 않을 수 있습니다. 환불 참고액과 포인트를 사용 금액에 중복 합산하지 않습니다.</p> : <>
      <div className="border-t border-[var(--share-line-strong)] pt-4"><h3 className="text-sm font-semibold">현재 DB 상태</h3>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{[
          ['memory_used_bytes', '메모리 사용'], ['memory_total_bytes', '메모리 전체'], ['connections', '현재 DB 연결'], ['connection_limit', 'DB 연결 한도'],
        ].map(([key, label]) => { const metric = `metrics_${key}_${environment}`; return <div key={key}><dt className={`text-xs ${muted}`}>{label}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{value(metric)}{get(metric)?.status === 'error' && <span className={`block text-xs font-normal ${muted}`}>이전 값 · 갱신 실패</span>}</dd></div> })}</dl>
        <p className={`mt-3 text-xs ${muted}`}>최근 수집 {time(`metrics_memory_used_bytes_${environment}`)} · 조회 시점의 상태입니다.{get(`metrics_status_${environment}`)?.status === 'error' && ' 최신 지표 수집에 실패했습니다.'}</p>
      </div>
    </>}
  </div>
}
