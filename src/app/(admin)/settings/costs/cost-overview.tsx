import { Activity, ArrowUpRight, Cloud, ScanText, Sparkles } from 'lucide-react'
import { estimateMoney, estimateUsage, PRICING_CHECKED_AT, CLAUDE_PRICING_URL, CLOVA_PRICING_URL } from '@/lib/costs/estimate'
import { snapshotValue, type UsageGroup } from '@/lib/costs/model'
import { reconcileClaude, type ClaudeReport } from '@/lib/costs/claude-report'
import { ClaudeConsoleReport } from './claude-console-report'

export type CostSnapshot = { provider: string; amount: number | null; currency: string; metric: string; updated_at: string; status: string }
const panel = 'rounded-[20px] bg-[var(--share-card)] p-5 sm:p-6'
const muted = 'text-[var(--share-muted)]'
const count = (n: number) => n.toLocaleString('ko-KR')
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const featureNames: Record<string, string> = {
  'week.parseAnswers': '답안지 파싱', 'week.parseQuestions': '시험지 파싱', 'week.grade': '답안 채점',
  'vocab.ocr': '단어시험 판독', 'vocab.grade': '단어시험 채점', 'sms.generate': '문자 내용 생성',
}

export function CostOverview({ usage, snapshots, report = null, tail = [], loading, tracking, failed }: { usage: UsageGroup[]; snapshots: CostSnapshot[]; report?: ClaudeReport | null; tail?: UsageGroup[]; loading: boolean; tracking: boolean; failed: boolean }) {
  const claude = estimateUsage(usage, 'claude')
  const naver = estimateUsage(usage, 'naver')
  const reconciled = report ? reconcileClaude(report, tail) : null
  const tokens = usage.filter(row => row.provider === 'claude').reduce((sum, row) => ({
    input: sum.input + row.input_tokens, output: sum.output + row.output_tokens,
    read: sum.read + row.cache_read_tokens, write: sum.write + row.cache_write_tokens,
  }), { input: 0, output: 0, read: 0, write: 0 })
  const breakdown = claude.items.filter(item => item.amount !== null).sort((a, b) => b.amount! - a.amount!)
  const waiting = failed ? '조회 실패' : loading ? '불러오는 중…' : tracking ? '기록 대기' : '기록 비활성'
  return <>
    <div className="grid grid-cols-2 gap-4 @min-[620px]:grid-cols-3">
      {([{ id: 'claude', name: 'Claude', subtitle: '조직 전체 · UTC 월 기준', icon: Sparkles, estimate: claude },
        { id: 'naver', name: '네이버 CLOVA', subtitle: 'General OCR · 글자 추출', icon: ScanText, estimate: naver },
        { id: 'gcp', name: 'GCP', subtitle: '워커 · 빌드 · 이미지 보관', icon: Cloud, estimate: null }] as const).map(service => {
        const snapshot = snapshots.find(row => row.provider === service.id && row.metric === 'monthly_cost')
        return <section key={service.id} className={`${panel} flex flex-col ${service.id === 'claude' ? 'col-span-2 @min-[620px]:col-span-1' : ''}`} aria-label={service.name + ' 조회액'}>
          <div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--share-box)] p-2.5"><service.icon size={19} aria-hidden="true" /></span><div><h2 className="text-[15px] font-bold">{service.name}</h2><p className={`mt-0.5 text-xs ${muted}`}>{service.subtitle}</p></div></div>
          <div className="mt-6 flex-1">
            <p className={`text-xs font-semibold ${service.estimate ? 'text-[var(--share-blue)]' : muted}`}>{service.id === 'claude' ? reconciled ? `이번 달 현재 누계 · ${reconciled.partial ? '일부 계산' : '예상'}` : '조직 보고서 수집 대기' : service.estimate ? `기록 기반 예상 비용${service.estimate.excludedCalls ? ' · 일부 계산' : ''}` : '업체 월 조회액'}</p>
            <p className="mt-2 text-xl leading-tight font-bold tracking-tight tabular-nums">{service.id === 'claude' ? failed ? '조회 실패' : reconciled ? snapshotValue(reconciled.total, 'USD') : '상세 수집 대기' : service.estimate ? failed ? '조회 실패' : service.estimate.amount !== null ? estimateMoney(service.estimate.amount, service.estimate.currency) : service.estimate.items.length ? '단가·기록 확인 필요' : waiting : snapshot?.amount != null ? snapshotValue(snapshot.amount, snapshot.currency) : '조회값 없음'}</p>
            <p className={`mt-2 min-h-9 text-xs leading-relaxed ${muted}`}>{service.id === 'claude' ? report ? `과거 사용량 복원 · ${report.models.length}개 모델` : '앱의 일부 기록을 월 전체 비용으로 표시하지 않습니다.' : service.id === 'naver' ? `${count(naver.units)}건 요청 × 3원 · 무료·할인 차감 전` : 'Google 청구 데이터 기준으로 표시합니다. 사용량으로 비용을 추정하지 않습니다.'}</p>
            {service.id !== 'claude' && !!service.estimate?.excludedCalls && <p className="mt-2 text-xs text-[var(--share-red)]">단가·기록 확인이 필요한 {count(service.estimate.excludedCalls)}회는 계산 제외</p>}
          </div>
          <div className="mt-5 border-t border-[var(--share-line-strong)] pt-4">
            {service.estimate && <div className="flex items-center justify-between gap-3"><span className={`text-xs ${muted}`}>업체 월 조회액</span><span className="text-base font-semibold tabular-nums">{service.id === 'claude' && report ? report.costThrough === report.start ? '미집계' : snapshotValue(report.reported, 'USD') : snapshot?.amount != null ? snapshotValue(snapshot.amount, snapshot.currency) : '조회값 없음'}</span></div>}
            <div className={`mt-2 flex items-start justify-between gap-2 text-[11px] ${muted}`}><span>{snapshot?.status === 'ok' ? '업체 조회 성공 · 확정 청구액 아님' : snapshot?.amount != null ? '갱신 실패 · 이전 조회액' : '청구 데이터 반영·연결 확인 필요'}</span><span className="shrink-0">{snapshot?.amount != null ? time(snapshot.updated_at) : '수신 대기'}</span></div>
          </div>
        </section>
      })}
    </div>
    <div className="flex items-start gap-2 rounded-2xl bg-[var(--share-blue-bg)] px-4 py-3 text-xs leading-relaxed text-[var(--share-body)]"><Activity size={16} className="mt-0.5 shrink-0 text-[var(--share-blue)]" aria-hidden="true" /><p>Claude는 조직 전체 사용량을 복원한 누계입니다. 앱 기능별 기록 {claude.amount !== null ? estimateMoney(claude.amount, 'USD') : '미수집'}은 일부 호출만 담고 있어 월 전체 비용과 다릅니다. 같은 시간의 사용량을 중복 합산하지 않습니다.</p></div>
    <ClaudeConsoleReport report={report} tail={tail} />
    <details className={panel}><summary className="cursor-pointer text-sm font-semibold">앱 기능별 기록·OCR 계산 기준 <span className={`ml-2 text-xs font-normal ${muted}`}>기록 활성화 이후 일부 호출만 포함</span></summary>
    <div className="mt-4 grid items-start gap-4 @min-[860px]:grid-cols-[1.6fr_1fr]">
      <section className={panel}>
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-[15px] font-extrabold">Claude 사용 내역</h2><p className={`mt-1 text-xs ${muted}`}>캐시 토큰도 별도 단가로 계산합니다.</p></div><span className={`text-xs ${muted}`}>{count(claude.calls)}회 호출</span></div>
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['입력 토큰', tokens.input], ['출력 토큰', tokens.output], ['캐시 읽기', tokens.read], ['캐시 쓰기', tokens.write]].map(([label, value]) => <div key={label} className="rounded-xl bg-[var(--share-box)] px-3 py-3"><dt className={`text-[11px] ${muted}`}>{label}</dt><dd className="mt-1 text-[15px] font-bold tabular-nums">{count(Number(value))}</dd></div>)}</dl>
        <h3 className="mt-6 text-xs font-semibold">기능별 예상 비용 · 월 전체 아님</h3>
        {claude.excludedCalls > 0 && <p className="mt-2 text-xs text-[var(--share-red)]">단가·토큰 확인이 필요한 {count(claude.excludedCalls)}회는 계산 제외</p>}
        <div className="mt-3 space-y-4">{breakdown.slice(0, 6).map(item => <div key={`${item.row.feature}:${item.row.model}`}>
          <div className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="break-words font-medium">{featureNames[item.row.feature] ?? item.row.feature}</p><p className={`mt-0.5 text-[11px] ${muted}`}>{item.row.model} · {count(item.row.calls)}회</p></div><span className="shrink-0 font-semibold tabular-nums">{estimateMoney(item.amount!, 'USD')}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--share-box)]"><div className="h-full rounded-full bg-[var(--share-blue)]" style={{ width: `${claude.amount ? item.amount! / claude.amount * 100 : 0}%` }} /></div>
        </div>)}</div>
        {!breakdown.length && <p className={`mt-5 text-sm ${muted}`}>{failed ? '사용량을 불러오지 못했습니다.' : '계산할 토큰 기록이 아직 없습니다.'}</p>}
        {breakdown.length > 6 && <p className={`mt-4 text-xs ${muted}`}>비용이 큰 6개 항목입니다. 전체 내역은 아래 기록 사용량에서 확인하세요.</p>}
      </section>
      <section className={panel}>
        <h2 className="text-[15px] font-extrabold">OCR 사용량과 계산 기준</h2>
        <div className="mt-5 flex items-end justify-between gap-4"><div><p className={`text-xs ${muted}`}>기록된 OCR 요청</p><p className="mt-1 text-xl font-bold tabular-nums">{count(naver.units)}<span className={`ml-1 text-sm font-medium ${muted}`}>건</span></p></div><div className="text-right"><p className={`text-xs ${muted}`}>General 글자 추출</p><p className="mt-1 text-lg font-bold">3원<span className={`text-xs font-normal ${muted}`}> / 건</span></p></div></div>
        <div className={`mt-5 space-y-3 border-t border-[var(--share-line-strong)] pt-4 text-xs leading-relaxed ${muted}`}>
          <p>월 100건 무료분은 계정 전체 사용량을 알 수 없어 차감하지 않았습니다. 무료분이 남아 있으면 실제 청구액이 더 적을 수 있습니다.</p>
          <p>요청 1건을 이미지 1장으로 환산합니다. PDF 페이지 수·실패 요청·API Gateway 비용은 실제 청구와 다를 수 있습니다. 부가세 별도입니다.</p>
        </div>
        <details className="mt-5 border-t border-[var(--share-line-strong)] pt-4"><summary className="cursor-pointer text-xs font-semibold">단가와 계산 범위 보기</summary><div className={`mt-3 space-y-3 text-xs leading-relaxed ${muted}`}><p>앱 기능별 기록은 일반 API·5분 캐시 단가로 환산한 일부 사용량입니다. 조직 보고서는 과거 기록을 복원하고 확인 가능한 Batch 할인·1시간 캐시·US 지역·Fast 요율을 적용합니다. 추가 도구 비용·별도 계약·세금·아직 업체에 반영되지 않은 사용량에 따라 차이가 남을 수 있습니다.</p><p>단가 확인일 {PRICING_CHECKED_AT}. 단가를 모르는 모델·OCR 상품은 계산에서 제외합니다.</p><a href={CLAUDE_PRICING_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[var(--share-blue)]">Claude 공식 단가<ArrowUpRight size={12} /></a><a href={CLOVA_PRICING_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[var(--share-blue)]">CLOVA 공식 단가<ArrowUpRight size={12} /></a></div></details>
      </section>
    </div></details>
  </>
}
