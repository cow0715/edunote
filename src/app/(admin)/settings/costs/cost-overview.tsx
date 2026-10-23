'use client'

import { useState } from 'react'
import './cost-visual.css'
import { ServiceOverview } from './service-overview'
import { SupabaseQuota } from './supabase-quota'
import { ArrowUpRight } from 'lucide-react'
import { estimateMoney, estimateUsage, PRICING_CHECKED_AT, CLAUDE_PRICING_URL, CLOVA_PRICING_URL } from '@/lib/costs/estimate'
import { type UsageGroup } from '@/lib/costs/model'
import { type ClaudeReport } from '@/lib/costs/claude-report'
import { ClaudeConsoleReport } from './claude-console-report'

export type CostSnapshot = { provider: string; amount: number | null; currency: string; metric: string; updated_at: string; status: string }
const panel = 'rounded-[20px] bg-[var(--share-card)] p-5 sm:p-6'
const muted = 'text-[var(--share-muted)]'
const count = (n: number) => n.toLocaleString('ko-KR')
const featureNames: Record<string, string> = {
  'week.parseAnswers': '답안지 파싱', 'week.parseQuestions': '시험지 파싱', 'week.grade': '답안 채점',
  'vocab.ocr': '단어시험 판독', 'vocab.grade': '단어시험 채점', 'sms.generate': '문자 내용 생성',
}

export function CostOverview({ usage, snapshots, report = null, tail = [], loading, failed, environment = 'production' }: { usage: UsageGroup[]; snapshots: CostSnapshot[]; report?: ClaudeReport | null; tail?: UsageGroup[]; loading: boolean; tracking: boolean; failed: boolean; environment?: string }) {
  const [selected, setSelected] = useState('all')
  const claude = estimateUsage(usage, 'claude')
  const naver = estimateUsage(usage, 'naver')
  const tokens = usage.filter(row => row.provider === 'claude').reduce((sum, row) => ({
    input: sum.input + row.input_tokens, output: sum.output + row.output_tokens,
    read: sum.read + row.cache_read_tokens, write: sum.write + row.cache_write_tokens,
  }), { input: 0, output: 0, read: 0, write: 0 })
  const breakdown = claude.items.filter(item => item.amount !== null).sort((a, b) => b.amount! - a.amount!)
  return <div className="cost-visual space-y-5">
    <ServiceOverview usage={usage} snapshots={snapshots} report={report} tail={tail} selected={selected} onSelect={setSelected} loading={loading} failed={failed} environment={environment} />
    {selected === 'supabase' && <SupabaseQuota snapshots={snapshots} environment={environment} />}
    {selected === 'claude' && <ClaudeConsoleReport report={report} tail={tail} />}
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
  </div>
}
