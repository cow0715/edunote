'use client'

import { useState } from 'react'
import { ArrowRight, ChevronRight, Search } from 'lucide-react'
import { AnalysisTrendChart } from '@/app/share/[token]/analysis-trend-chart'
import { Card } from '@/app/share/[token]/share-components'
import { PRESS, T } from '@/app/share/[token]/share-tokens'
import { fmtWeekLabel, getWeekLabel } from '@/app/share/[token]/share-utils'
import type { ShareModel } from '@/app/share/[token]/use-share-model'
import { ANALYSIS_MIN_APPEARANCES, ANALYSIS_MIN_QUESTIONS, ANALYSIS_STATUS_LABELS, type AnalysisStatus, type AnalysisType } from '@/lib/share-analysis'

type TagAction = (id: string, name: string) => void
type HistoryProps = {
  version: 'list' | 'trend'
  model: ShareModel
  periodLabel?: string
  onTagClick: TagAction
  onOpenWrongNote: () => void
}
const STATUS_ORDER: AnalysisStatus[] = ['priority', 'review', 'stable', 'insufficient']

/** Historical layouts read the same current model as the live report. */
export function ShareAnalysisHistory(props: HistoryProps) {
  const key = `${props.version}:${props.model.weeks.map((week) => week.id).join('|')}`
  return <HistoryContent key={key} {...props} />
}

function HistoryContent({ version, model, periodLabel, onTagClick, onOpenWrongNote }: HistoryProps) {
  const summary = model.analysisSummary
  const focus = summary.focus
  const chartTypes = [...new Map([focus, summary.improvement, summary.strength, ...summary.priorities, ...summary.types]
    .filter((type): type is AnalysisType => type !== null)
    .map((type) => [type.id, type])).values()].slice(0, 3)
  return (
    <div className="space-y-3 text-[var(--share-ink)]">
      <section className="px-1.5 pt-3 pb-2" aria-label="복습 제안">
        <p className="text-[12px] leading-relaxed text-[var(--share-muted)] tabular-nums">
          {periodLabel ?? '선택 기간'} 독해 분석 · 확인된 {summary.weekCount}회차 · {summary.readingCount}문항
        </p>
        <h1 className="mt-3 whitespace-pre-line break-words text-[23px] leading-[1.32] font-bold tracking-[-0.025em]">{summary.headline}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--share-muted)]">{summary.description}</p>
        {version === 'list' && focus && focus.wrong > 0 && <button type="button" onClick={() => onTagClick(focus.id, focus.name)}
          aria-label={`${focus.name} 오답 ${focus.wrong}문항 보기`}
          className={`${PRESS} mt-5 flex min-h-12 w-full items-center justify-between gap-3 rounded-[14px] bg-[var(--control-bg)] px-4 py-3 text-left text-[14px] font-bold text-[var(--control-fg)]`}>
          <span>{focus.name} 오답 보기</span><ArrowRight size={18} className="shrink-0" aria-hidden />
        </button>}
        {!focus && summary.wrongCount > 0 && <button type="button" onClick={onOpenWrongNote}
          className={`${PRESS} mt-5 flex min-h-12 w-full items-center justify-between gap-3 rounded-[14px] bg-[var(--control-bg)] px-4 py-3 text-left text-[14px] font-bold text-[var(--control-fg)]`}>
          <span>오답 {summary.wrongCount}문항 확인하기</span><ArrowRight size={18} className="shrink-0" aria-hidden />
        </button>}
      </section>
      {version === 'trend' && <>
        {summary.priorities.length > 0 && <Card title="먼저 복습할 유형" aside="기간 정답률">
          <section aria-label="복습할 유형" className="divide-y divide-[var(--share-line)]">
            {summary.priorities.map((type) => <button type="button" key={type.id} onClick={() => onTagClick(type.id, type.name)}
              aria-label={`${type.name} 오답 ${type.wrong}문항 보기`} className={`${PRESS} block min-h-11 w-full py-3 text-left`}>
              <span className="flex items-center justify-between gap-3 text-[14px] font-bold"><span className="break-words">{type.name}</span>
                <span className="flex shrink-0 items-center gap-1 tabular-nums">{type.cumulative.rate}%<ChevronRight size={16} aria-hidden /></span></span>
              <span className="mt-1.5 block text-[12px] leading-relaxed text-[var(--share-muted)] tabular-nums">{type.total}문항 중 오답 {type.wrong}{type.status === 'insufficient' ? ' · 판정 보류' : ''}</span>
              {type.status === 'stable' && type.recentStatus === 'priority' && <span className="mt-1 block text-[12px] leading-relaxed tabular-nums" style={{ color: T.red }}>최근 {type.recentCount}회 정답률 {type.recent.rate}% · 최근 결과 확인</span>}
              {type.status !== 'insufficient' && type.recentStatus === 'stable' && <span className="mt-1 block text-[12px] leading-relaxed text-[var(--share-muted)]">최근에는 안정적이에요 · 이전 오답 확인</span>}
            </button>)}
          </section>
        </Card>}
        {chartTypes.length > 0 && <Card title="유형별 정답률 흐름" aside="최근 출제 회차">
          <AnalysisTrendChart types={chartTypes} allTypes={summary.types} weeks={model.weeks} onTagClick={onTagClick}
            improvementId={summary.improvement?.id} strengthId={summary.strength?.id} />
        </Card>}
      </>}
      {summary.types.length > 0 && (version === 'list'
        ? <Card title="유형별 오답률" aside="선택 기간 누적"><HistoricalTypeList types={summary.types} mode="wrong" onTagClick={onTagClick} /></Card>
        : <HistoricalTypeOverview model={model} onTagClick={onTagClick} />)}
      {summary.untaggedCount > 0 && <p className="px-1.5 text-[12px] leading-relaxed text-[var(--share-muted)]">유형 미분류 {summary.untaggedCount}문항은 유형·영역 비교에서 제외했어요.</p>}
      {summary.trends.length > 0 && <details className="group border-t border-[var(--share-line)] px-1.5">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-bold [&::-webkit-details-marker]:hidden">
          출제 회차별 변화<ChevronRight size={16} className="text-[var(--share-muted)] transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <Card title="회차별 정답률" aside="실제 출제 기록"><HistoricalAppearances model={model} onTagClick={onTagClick} /></Card>
      </details>}
      {model.radarData.length > 0 && <details className="group border-t border-[var(--share-line)] px-1.5">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-bold [&::-webkit-details-marker]:hidden">
          영역별 정답률<ChevronRight size={16} className="text-[var(--share-muted)] transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <Card title="영역별 요약" aside="선택 기간 누적">
          <p className="mb-4 text-[12px] leading-relaxed text-[var(--share-muted)]">영역마다 문항 수가 달라요.</p>
          <section aria-label="영역별 요약" className="space-y-5">
            {model.radarData.map((area) => {
              const tags = model.radarLegend.find((legend) => legend.name === area.name)?.tags ?? []
              return <div key={area.name}>
                <div className="flex items-baseline justify-between gap-3 text-[14px] font-bold"><span>{area.name}</span><span className="shrink-0 tabular-nums">{area.rate}%</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--share-box-on-card)]" aria-hidden><div className="h-full rounded-full" style={{ width: `${area.rate}%`, background: T.body2 }} /></div>
                <p className="mt-2 text-[12px] text-[var(--share-muted)] tabular-nums">{area.total}문항 중 {area.correct}문항 정답</p>
                <details className="mt-1 text-[12px] leading-relaxed text-[var(--share-muted)]"><summary className={`${PRESS} min-h-11 cursor-pointer py-3`}>포함된 유형 {tags.length}개</summary><p>{tags.join(' · ')}</p></details>
              </div>
            })}
          </section>
        </Card>
      </details>}
      {summary.types.length > 0 && <details className="border-t border-[var(--share-line)] px-1.5 text-[12px] leading-relaxed text-[var(--share-muted)]">
        <summary className={`${PRESS} min-h-14 cursor-pointer py-4 font-semibold`}>분석 기준과 추천 이유</summary>
        <div className="space-y-3 pb-5">
          <p>유형별 분류와 수치는 선택 기간의 전체 문항을 합산해요. 기간 밖의 기록은 합치지 않아요.</p>
          <p>{ANALYSIS_MIN_APPEARANCES}회 출제·{ANALYSIS_MIN_QUESTIONS}문항 미만이면 판정을 보류해요. 충분한 기록에서 정답률 60% 미만은 우선 보완, 60~80% 미만은 복습 권장, 80% 이상은 안정적이에요. 학생의 고정된 실력을 확정하는 기준은 아니에요.</p>
          {summary.priorities.map((type) => <p key={type.id}><strong className="font-extrabold text-[var(--share-body2)]">{type.name}</strong> · {type.reason}</p>)}
        </div>
      </details>}
    </div>
  )
}

function HistoricalTypeOverview({ model, onTagClick }: { model: ShareModel; onTagClick: TagAction }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<AnalysisStatus | 'all'>('all')
  const [searchKey, setSearchKey] = useState(0)
  const summary = model.analysisSummary
  return <Card title="전체 유형" aside={`${summary.types.length}개 유형`}>
    <section aria-label="전체 유형 상태">
      <p className="text-[11px] text-[var(--share-muted)]">선택 기간 누적 기준 · 분류를 눌러 확인해요</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {STATUS_ORDER.map((group) => <button type="button" key={group} aria-label={`${ANALYSIS_STATUS_LABELS[group]} ${summary.statusCounts[group]}개 유형 보기`}
          aria-pressed={open && status === group} onClick={() => { setOpen(true); setStatus(group); setSearchKey((key) => key + 1) }}
          className={`${PRESS} flex min-h-11 items-center justify-between gap-2 rounded-[14px] px-3 py-2 text-left`}
          style={{ background: open && status === group ? T.selected : T.boxOnCard }}>
          <span className="text-[12px] font-semibold" style={{ color: group === 'priority' ? T.red : T.body2 }}>{ANALYSIS_STATUS_LABELS[group]}</span>
          <span className="text-[20px] font-bold tabular-nums">{summary.statusCounts[group]}<span className="ml-1 text-[11px] font-medium text-[var(--share-muted)]">개</span></span>
        </button>)}
      </div>
      <button type="button" aria-expanded={open} onClick={() => { if (!open) setStatus('all'); setOpen(!open) }} className={`${PRESS} mt-3 flex min-h-11 w-full items-center justify-between text-[12px] font-semibold`}>
        {open ? '유형 목록 접기' : '전체 유형 보기'}<ChevronRight size={16} className={`text-[var(--share-muted)] ${open ? '-rotate-90' : 'rotate-90'}`} aria-hidden />
      </button>
      {open && <HistoricalTypeList key={searchKey} types={summary.types} mode="correct" status={status} onStatusChange={setStatus} onTagClick={onTagClick} />}
    </section>
  </Card>
}

function HistoricalTypeList({ types, mode, status = 'all', onStatusChange, onTagClick }: {
  types: AnalysisType[]; mode: 'wrong' | 'correct'; status?: AnalysisStatus | 'all'
  onStatusChange?: (status: AnalysisStatus | 'all') => void; onTagClick: TagAction
}) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const matched = types.filter((type) => (status === 'all' || type.status === status)
    && type.name.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR')))
  const shown = expanded ? matched : matched.slice(0, 8)
  return <section aria-label="유형 목록">
    {onStatusChange && <div className="mb-3 space-y-2">
      <label className="flex min-h-11 items-center gap-2 rounded-[14px] bg-[var(--share-box-on-card)] px-3 focus-within:outline-2 focus-within:outline-[var(--share-line-strong)]">
        <Search size={15} className="shrink-0 text-[var(--share-muted)]" aria-hidden />
        <input type="search" value={query} aria-label="유형 이름 검색" placeholder="유형 이름으로 찾기" onChange={(event) => { setQuery(event.target.value); setExpanded(false) }} className="min-w-0 flex-1 bg-transparent py-3 text-[13px] outline-none placeholder:text-[var(--share-muted)]" />
      </label>
      <select aria-label="유형 상태 필터" value={status} onChange={(event) => { onStatusChange(event.target.value as AnalysisStatus | 'all'); setExpanded(false) }} className="min-h-11 w-full rounded-[14px] bg-[var(--share-box-on-card)] px-3 text-[13px] font-semibold">
        <option value="all">전체 유형 ({types.length})</option>
        {STATUS_ORDER.map((group) => <option key={group} value={group}>{ANALYSIS_STATUS_LABELS[group]} ({types.filter((type) => type.status === group).length})</option>)}
      </select>
    </div>}
    <p className="mb-2 text-[11px] text-[var(--share-muted)]" role="status">{matched.length}유형{shown.length < matched.length ? ` 중 ${shown.length}유형 표시` : ''}</p>
    {shown.length === 0 && <p className="py-4 text-[13px] text-[var(--share-muted)]">조건에 맞는 유형이 없어요.</p>}
    <div className="divide-y divide-[var(--share-line)]">
      {shown.map((type) => {
        const value = mode === 'wrong' ? Math.round(type.wrong / type.total * 100) : type.cumulative.rate
        const content = <>
          <span className="flex items-baseline justify-between gap-3 text-[14px] font-bold"><span className="break-words">{type.name}</span><span className="shrink-0 tabular-nums">{value}%</span></span>
          {mode === 'wrong' && <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--share-box-on-card)]" aria-hidden><span className="block h-full rounded-full" style={{ width: `${value}%`, background: T.body2 }} /></span>}
          <span className="mt-2 block text-[12px] leading-relaxed text-[var(--share-muted)] tabular-nums">{mode === 'wrong' ? `${type.total}문항 중 오답 ${type.wrong}` : `기간 ${type.cumulative.correct}/${type.total}문항 정답`} · {type.points.length}회 출제</span>
          <span className="mt-1 block text-[11px] font-semibold" style={{ color: type.status === 'priority' ? T.red : T.muted }}>{ANALYSIS_STATUS_LABELS[type.status]}{type.wrong > 0 ? ' · 오답 보기' : ''}</span>
        </>
        return type.wrong > 0
          ? <button type="button" key={type.id} onClick={() => onTagClick(type.id, type.name)} aria-label={`${type.name} 오답 ${type.wrong}문항 보기`} className={`${PRESS} block min-h-11 w-full py-3 text-left`}>{content}</button>
          : <div key={type.id} className="py-3">{content}</div>
      })}
    </div>
    {matched.length > 8 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className={`${PRESS} mt-3 min-h-11 text-[13px] font-semibold text-[var(--share-blue)]`}>{expanded ? '유형 접기' : `유형 ${matched.length - 8}개 더 보기`}</button>}
    <p className="mt-3 text-[11px] leading-relaxed text-[var(--share-muted)]">{ANALYSIS_MIN_APPEARANCES}회·{ANALYSIS_MIN_QUESTIONS}문항 미만은 판정을 보류해요. 여러 유형에 속한 문제는 각 유형에 포함돼요.</p>
  </section>
}

function HistoricalAppearances({ model, onTagClick }: { model: ShareModel; onTagClick: TagAction }) {
  const [expanded, setExpanded] = useState(false)
  const types = model.analysisSummary.trends
  const shown = expanded ? types : types.slice(0, 3)
  const weekLabel = (id: string) => {
    const week = model.weeks.find((item) => item.id === id)
    return week ? `${getWeekLabel(week)}${week.start_date ? ` · ${fmtWeekLabel(week)}` : ''}` : '회차 미상'
  }
  return <section aria-label="출제 회차 기록">
    <div className="divide-y divide-[var(--share-line)]">
      {shown.map((type) => {
        const previous = type.points.at(-2)!
        const latest = type.points.at(-1)!
        return <div key={type.id} className="py-4">
          <h3 className="text-[14px] font-bold">{type.name}</h3>
          <p className="mt-3 flex items-center gap-2 text-[20px] font-bold tabular-nums"><span className="text-[var(--share-muted)]">{previous.rate}%</span><ArrowRight size={16} aria-label="에서" className="text-[var(--share-muted)]" /><span>{latest.rate}%</span></p>
          <div className="mt-2 space-y-1 text-[12px] leading-relaxed text-[var(--share-muted)] tabular-nums"><p>{weekLabel(previous.weekId)} · {previous.correct}/{previous.total}문항 정답</p><p>{weekLabel(latest.weekId)} · {latest.correct}/{latest.total}문항 정답</p></div>
          <details className="mt-1 text-[12px] leading-relaxed text-[var(--share-muted)]"><summary className={`${PRESS} min-h-11 cursor-pointer py-3`}>출제 {type.points.length}회 기록 모두 보기</summary><div className="space-y-2 pb-2">{type.points.map((point) => <p key={point.weekId} className="tabular-nums">{weekLabel(point.weekId)} · {point.correct}/{point.total}문항 정답 · {point.rate}%</p>)}</div></details>
          {type.wrong > 0 && <button type="button" aria-label={`${type.name} 관련 오답 보기`} onClick={() => onTagClick(type.id, type.name)} className={`${PRESS} min-h-11 text-[13px] font-semibold text-[var(--share-blue)]`}>관련 오답 보기</button>}
        </div>
      })}
    </div>
    {types.length > 3 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className={`${PRESS} mt-2 min-h-11 text-[13px] font-semibold text-[var(--share-blue)]`}>{expanded ? '변화 접기' : `다른 유형 변화 ${types.length - 3}개 보기`}</button>}
    <p className="mt-3 text-[11px] leading-relaxed text-[var(--share-muted)]">실제 출제한 회차의 수치예요. 두 회차의 차이만으로 약점이나 개선을 판단하지 않아요.</p>
  </section>
}
