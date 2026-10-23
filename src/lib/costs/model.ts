import { z } from 'zod'

export const providers = ['vercel', 'supabase', 'naver', 'claude', 'solapi', 'gcp', 'other'] as const
export const environments = ['production', 'development', 'test'] as const
export const services = [
  { id: 'vercel', name: 'Vercel', role: '웹·API 배포', url: 'https://vercel.com/dashboard' },
  { id: 'supabase', name: 'Supabase', role: 'DB·Storage·인증', url: 'https://supabase.com/dashboard' },
  { id: 'naver', name: '네이버 CLOVA', role: '사진 OCR', url: 'https://console.ncloud.com/' },
  { id: 'claude', name: 'Claude', role: '파싱·채점·어휘 처리', url: 'https://platform.claude.com/usage' },
  { id: 'solapi', name: 'SOLAPI', role: '문자 발송', url: 'https://console.solapi.com/' },
  { id: 'gcp', name: 'GCP', role: '워커·빌드·이미지·로그 보관', url: 'https://console.cloud.google.com/billing' },
  { id: 'other', name: '기타', role: '도메인·기타 구독', url: '' },
] as const
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
export const entrySchema = z.object({
  provider: z.enum(providers), environment: z.enum(environments), month: monthSchema,
  kind: z.enum(['actual', 'estimate', 'topup', 'budget']),
  currency: z.enum(['KRW', 'USD']), amount: z.number().finite().min(0).max(1e12),
  note: z.string().trim().max(200).default(''),
})
export type CostEntry = z.infer<typeof entrySchema> & { id: string; source: string; updated_at: string }
export type UsageGroup = { provider: string; feature: string; model: string; calls: number; units: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number }
export function koreanMonth(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(now)
}
export function monthBounds(month: string) {
  monthSchema.parse(month)
  const [year, index] = month.split('-').map(Number)
  return { start: new Date(Date.UTC(year, index - 1, 1, -9)).toISOString(), end: new Date(Date.UTC(year, index, 1, -9)).toISOString() }
}
export function snapshotLabel(metric: string) {
  const health = /^metrics_(memory_used_bytes|memory_total_bytes|connections|connection_limit|status)_(production|development)$/.exec(metric)
  if (health) {
    const names: Record<string, string> = { memory_used_bytes: '메모리 사용', memory_total_bytes: '메모리 전체', connections: 'DB 연결', connection_limit: 'DB 연결 한도', status: '공식 지표 수집 상태' }
    return `${health[2] === 'production' ? '운영' : '개발'} ${names[health[1]]} · 공식 지표`
  }
  const labels: Record<string, string> = {
    message_total: '업체 메시지 총 발송', message_succeeded: '메시지 성공', message_failed: '메시지 실패', sms_succeeded: '문자 성공(SMS·LMS·MMS)', sms_failed: '문자 실패', sms_count: 'SMS 성공', lms_count: 'LMS 성공', mms_count: 'MMS 성공', cash_usage: '캐시 사용액', deposit_usage: '예치금 사용액', point_usage: '포인트 사용', cash_refund: '캐시·예치금 환불(참고)', point_refund: '포인트 환불(참고)',
    console_cycle_start: '콘솔 청구주기 시작', console_cycle_end: '콘솔 청구주기 종료', console_egress_gb: '조직 전송량(콘솔)', console_cached_egress_gb: '조직 캐시 전송량(콘솔)', console_mau: '조직 MAU(콘솔)', console_storage_gb: '조직 평균 Storage(콘솔)', invoice_last_amount: '최근 발행 청구서 금액', invoice_last_issued_at: '최근 청구서 발행일',
    console_monthly_cost: '콘솔 수동 확인액 · 자동 수신 대기',
    worker_executions: 'Worker 실행 횟수', worker_succeeded: 'Worker 성공', worker_failed: 'Worker 실패·취소', worker_running: 'Worker 진행 중', worker_wall_seconds: 'Worker 실행 시간 합계',
    balance: '조회 시점 계정 잔액', monthly_cost: '업체 월 조회액',
    db_bytes_production: '운영 DB 크기', db_bytes_development: '개발 DB 크기',
    storage_bytes_production: '운영 Storage 크기', storage_bytes_development: '개발 Storage 크기',
    files_production: '운영 저장 파일', files_development: '개발 저장 파일',
    plan_free: '현재 Free 플랜 기본료',
    plan_hobby: '현재 Hobby 플랜 기본료',
    infrastructure: 'DB·Storage 사용량',
    message_history_production: '운영 학생별 문자 기록(실발송 건수와 다름)',
    message_history_development: '개발 학생별 문자 기록(실발송 건수와 다름)',
  }
  return labels[metric] ?? metric
}
export function snapshotValue(amount: number | null, currency: string) {
  if (amount === null) return '조회값 없음'
  if (currency === 'TIMESTAMP') return new Date(amount * 1000).toLocaleDateString('ko-KR', { timeZone: 'UTC' })
  if (currency === 'GB') return `${amount.toLocaleString('ko-KR', { maximumFractionDigits: 3 })} GB`
  if (currency === 'POINTS') return `${amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} P`
  if (currency === 'SECONDS') return `${(amount / 60).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}분`
  if (currency === 'BYTES') return `${(amount / 1024 / 1024).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} MiB`
  if (currency === 'COUNT') return `${amount.toLocaleString('ko-KR')}개`
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}
/** A monthly actual replaces estimates for that provider/currency, never adds to them. */
export function summarize(entries: CostEntry[]) {
  return (['KRW', 'USD'] as const).map(currency => {
    let actual = 0, estimate = 0, budget = 0, topup = 0
    for (const provider of providers) {
      const rows = entries.filter(e => e.provider === provider && e.currency === currency)
      const confirmed = rows.filter(e => e.kind === 'actual')
      actual += confirmed.reduce((n, e) => n + e.amount, 0)
      if (!confirmed.length) estimate += rows.filter(e => e.kind === 'estimate').reduce((n, e) => n + e.amount, 0)
      budget += rows.filter(e => e.kind === 'budget').reduce((n, e) => n + e.amount, 0)
      topup += rows.filter(e => e.kind === 'topup').reduce((n, e) => n + e.amount, 0)
    }
    return { currency, actual, estimate, budget, topup, total: actual + estimate }
  })
}
