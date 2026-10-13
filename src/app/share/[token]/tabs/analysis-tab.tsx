'use client'

import { useState, type ReactNode } from 'react'
import { ArrowRight, ChevronRight, Search } from 'lucide-react'
import { Card } from '../share-components'
import { AnalysisTrendChart } from '../analysis-trend-chart'
import { AnalysisPriorityChart } from '../analysis-priority-chart'
import { PRESS, T } from '../share-tokens'
import type { ShareModel } from '../use-share-model'
import { fmtWeekLabel, getWeekLabel } from '../share-utils'
import { SMALL_SAMPLE_MAX } from '@/lib/wrong-rate'
import { ANALYSIS_MIN_APPEARANCES, ANALYSIS_MIN_QUESTIONS, ANALYSIS_RECENT_APPEARANCES, ANALYSIS_STATUS_LABELS, type AnalysisStatus, type AnalysisType, type ShareAnalysisSummary } from '@/lib/share-analysis'

type TagAction = (id: string, name: string) => void

export function AnalysisTab({ model, periodLabel, onTagClick, onOpenWrongNote }: {
  model: ShareModel
  periodLabel?: string
  onTagClick: TagAction
  onOpenWrongNote: () => void
}) {
  const { analysisSummary: summary, radarData, radarLegend } = model
  const { focus } = summary
  const periodKey = model.weeks.map((week) => week.id).join('|')
  const chartTypes = [...new Map([focus, summary.improvement, summary.strength, ...summary.priorities, ...summary.types]
    .filter((type): type is AnalysisType => type !== null)
    .map((type) => [type.id, type])).values()].slice(0, 3)
  const activeFocus = focus && (focus.status === 'priority' || focus.status === 'review') && focus.recentStatus !== 'stable'
  const headline = activeFocus ? `${focus.name}부터\n복습해 보세요.` : summary.headline
  const shortReason = focus
    ? focus.status === 'insufficient'
      ? '기록이 더 쌓이면 약점을 판단할 수 있어요.'
      : focus.status === 'stable' && focus.recentStatus === 'priority'
        ? '기간 성적은 안정적이지만, 최근 오답을 살펴볼 필요가 있어요.'
        : focus.recentStatus === 'stable'
          ? '최근에는 잘 풀고 있어요. 남은 오답을 확인해요.'
          : `${focus.points.length}회 출제 중 ${focus.wrongAppearances}회에 오답이 있었어요.`
    : summary.description
  return (
    <div className="space-y-3 text-[var(--share-ink)]">
      <section className="px-1.5 pt-3 pb-2" aria-label="먼저 살펴볼 내용">
        <p className="text-[12px] leading-relaxed text-[var(--share-muted)] tabular-nums">
          {periodLabel ?? '선택 기간'} 독해 분석 · 확인된 {summary.weekCount}회차 · {summary.readingCount}문항
        </p>
        <h1 className="mt-3 whitespace-pre-line break-words text-[23px] leading-[1.32] font-bold tracking-[-0.025em]">{headline}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--share-muted)] tabular-nums">{shortReason}</p>
        {!focus && summary.wrongCount > 0 && (
          <button type="button" onClick={onOpenWrongNote}
            className={`${PRESS} mt-5 flex min-h-12 w-full items-center justify-between gap-3 rounded-[14px] bg-[var(--control-bg)] px-4 py-3 text-left text-[14px] font-bold text-[var(--control-fg)]`}>
            <span>오답 {summary.wrongCount}문항 확인하기</span>
            <ArrowRight size={18} className="shrink-0" aria-hidden />
          </button>
        )}
      </section>
      {summary.types.length > 0 && (
        <TypeOverview key={periodKey} summary={summary} onTagClick={onTagClick} />
      )}
      {summary.priorities.length > 0 && (
        <Card title="먼저 확인할 유형" aside="기간 오답률">
          <AnalysisPriorityChart types={summary.priorities} onTagClick={onTagClick} />
          <ErrorDistribution summary={summary} />
        </Card>
      )}
      {chartTypes.length > 0 && (
        <AnalysisDisclosure key={`chart-${periodKey}`} title="유형별 최근 흐름" unit="회차별 그래프" deferContent>
          <AnalysisTrendChart key={periodKey} types={chartTypes} allTypes={summary.types} weeks={model.weeks} onTagClick={onTagClick}
            improvementId={summary.improvement?.id} strengthId={summary.strength?.id} />
        </AnalysisDisclosure>
      )}
      {summary.untaggedCount > 0 && (
        <p className="px-1.5 text-[12px] leading-relaxed text-[var(--share-muted)]">유형 미분류 {summary.untaggedCount}문항은 유형·영역 비교에서 제외했어요.</p>
      )}
      {summary.trends.length > 0 && (
        <AnalysisDisclosure key={`trends-${periodKey}`} title="회차별 변화" unit="정답률 비교">
          <TrendList key={periodLabel} types={summary.trends} model={model} onTagClick={onTagClick} />
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--share-muted)]">회차별 실제 수치예요. 두 회차의 차이만으로 약점이나 개선을 판단하지 않아요.</p>
        </AnalysisDisclosure>
      )}
      {radarData.length > 0 && (
        <AnalysisDisclosure key={`areas-${periodKey}`} title="영역별 요약" unit={`${radarData.length}개 영역`}>
          <p className="mb-4 text-[12px] leading-relaxed text-[var(--share-muted)]">선택 기간 누적 정답률 · 영역마다 문항 수가 달라요.</p>
          <div className="space-y-5">
            {radarData.map((area) => {
              const tags = radarLegend.find((item) => item.name === area.name)?.tags ?? []
              return (
                <div key={area.name}>
                  <div className="flex items-baseline justify-between gap-4 text-[14px]">
                    <span className="font-bold">{area.name}</span><strong className="shrink-0 tabular-nums">{area.rate}%</strong>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--share-box)]" aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${area.rate}%`, background: T.body2 }} />
                  </div>
                  <p className="mt-2 text-[12px] text-[var(--share-muted)] tabular-nums">{area.total}문항 중 {area.correct}문항 정답</p>
                  <details className="mt-1 text-[12px] leading-relaxed text-[var(--share-muted)]">
                    <summary className={`${PRESS} min-h-11 cursor-pointer py-3`}>포함된 유형 {tags.length}개</summary>
                    <p>{tags.join(' · ')}</p>
                  </details>
                </div>
              )
            })}
          </div>
        </AnalysisDisclosure>
      )}
      {summary.types.length > 0 && <AnalysisDisclosure key={`criteria-${periodKey}`} title="분석 기준과 추천 이유" unit="계산 방법">
        <div className="space-y-3 text-[12px] leading-relaxed text-[var(--share-muted)]">
          <p>보완 분류는 선택한 학습기간의 전체 정답 수와 문항 수를 합산해 계산해요. 출제 수를 고려한 오답 비율과 반복 회차를 참고해, 복습할 유형을 최대 세 개 추천해요. 기간 밖의 기록은 합치지 않아요.</p>
          <p>유형별 {ANALYSIS_MIN_APPEARANCES}회 이상 출제·{ANALYSIS_MIN_QUESTIONS}문항 이상일 때 분류해요. 그 전에는 기록 부족으로 표시하고 실제 오답을 확인할 수 있어요. 기간 정답률 60% 미만은 우선 보완, 60~80% 미만은 복습 권장, 80% 이상은 안정적이에요. 비율은 반올림해 표시하고 분류는 반올림 전 비율로 정해요.</p>
          <p>최근 흐름은 해당 유형이 실제로 나온 최근 최대 {ANALYSIS_RECENT_APPEARANCES}회와 그 이전 최대 {ANALYSIS_RECENT_APPEARANCES}회를 비교해요. 두 묶음 각각 {ANALYSIS_MIN_APPEARANCES}회·{ANALYSIS_MIN_QUESTIONS}문항 이상일 때만 변화량을 표시하고, 실제 비율이 15%p 이상 높아졌을 때 개선으로 소개해요. 기록이 부족해도 실제 회차별 그래프는 볼 수 있어요.</p>
          <p>충분한 최근 기록이 안정적이면 예전 약점을 보완 추천에 섞지 않아요. 기간 전체는 안정적이어도 최근 결과에 오답이 많이 남으면 ‘최근 결과 확인’으로 먼저 안내해요. 강점은 기간과 충분한 최근 기록 모두 안정적이고 최근 각 회차도 80% 이상일 때 보여드려요. 문항 수와 난도에 따라 결과가 달라질 수 있어요.</p>
          <p>{ANALYSIS_MIN_APPEARANCES}회·{ANALYSIS_MIN_QUESTIONS}문항과 비율 기준은 복습 안내를 위한 기준이며, 학생의 고정된 실력을 확정하는 기준은 아니에요.</p>
          <p>오답 범위는 추천 상위 두 유형에 속한 문항을 합친 결과예요. 여러 유형에 속한 오답도 한 문항으로 계산했어요.</p>
          {summary.priorities.map((type) => <p key={type.id}><strong className="font-extrabold text-[var(--share-body2)]">{type.name}</strong> · {type.reason}</p>)}
        </div>
      </AnalysisDisclosure>}
    </div>
  )
}

function ErrorDistribution({ summary }: { summary: ShareAnalysisSummary }) {
  const { concentration } = summary
  if (!concentration || concentration.totalWrong <= SMALL_SAMPLE_MAX) return null
  const other = concentration.totalWrong - concentration.wrong
  return (
    <details className="mt-3 border-t border-[var(--share-line)] text-[12px] text-[var(--share-muted)]" aria-label="추천 유형의 오답 범위">
      <summary className="min-h-11 cursor-pointer py-3 leading-relaxed">상위 {concentration.names.length}유형에 오답 {concentration.wrong}문항 포함</summary>
      <p className="leading-relaxed">전체 오답의 <strong className="font-extrabold tabular-nums">{concentration.share}%</strong> · {concentration.names.join(' · ')}</p>
      <p className="mt-1 leading-relaxed tabular-nums">추천 유형 {concentration.wrong}문항 · 그 외 {other}문항</p>
      {concentration.share < 50 && <p className="mt-2">오답이 여러 유형에 나뉘어 있어요.</p>}
      <p className="mt-2 pb-1 leading-relaxed">여러 유형에 속한 오답도 한 문항으로 계산했어요.</p>
    </details>
  )
}

function AnalysisDisclosure({ title, unit, children, deferContent = false }: { title: string; unit: string; children: ReactNode; deferContent?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} className="group border-t border-[var(--share-line)] px-1.5">
      <summary onClick={(event) => { event.preventDefault(); setOpen(!open) }} className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="text-[13px] font-bold">{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--share-muted)]">{unit}<ChevronRight size={16} className="transition-transform group-open:rotate-90" aria-hidden /></span>
      </summary>
      <section aria-label={title} className="pt-1 pb-5">
        {(!deferContent || open) && children}
      </section>
    </details>
  )
}

const STATUS_DISPLAY_ORDER: AnalysisStatus[] = ['priority', 'review', 'stable', 'insufficient']

function TypeOverview({ summary, onTagClick }: { summary: ShareAnalysisSummary; onTagClick: TagAction }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<AnalysisStatus | 'all'>('all')
  const [searchKey, setSearchKey] = useState(0)
  return (
    <section aria-label="전체 유형 분석">
      <div className="px-1.5 pb-2">
        <h2 className="text-[12px] font-semibold text-[var(--share-muted)]">{summary.types.length}개 유형 · 선택 기간 누적</h2>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {STATUS_DISPLAY_ORDER.map((group) => <button type="button" key={group}
            aria-label={`${ANALYSIS_STATUS_LABELS[group]} ${summary.statusCounts[group]}개 유형 보기`}
            aria-pressed={open && status === group}
            onClick={() => { setStatus(group); setSearchKey((key) => key + 1); setOpen(true) }}
            className={`${PRESS} flex min-h-11 items-center justify-between gap-2 rounded-xl px-2 text-left`}
            style={{ background: open && status === group ? T.boxOnCard : undefined }}>
            <span className="text-[12px] font-semibold" style={{ color: group === 'priority' ? T.red : T.muted }}>{ANALYSIS_STATUS_LABELS[group]}</span>
            <span className="text-[20px] font-bold tabular-nums" style={{ color: group === 'priority' ? T.red : T.ink }}>{summary.statusCounts[group]}<span className="ml-1 text-[11px] font-medium text-[var(--share-muted)]">개</span></span>
          </button>)}
        </div>
        <button type="button" aria-expanded={open} onClick={() => { if (!open) setStatus('all'); setOpen(!open) }}
          className={`${PRESS} mt-2 flex min-h-11 w-full items-center justify-between border-t border-[var(--share-line)] pt-2 text-[12px] font-semibold`}>
          {open ? '유형 목록 접기' : '전체 유형 살펴보기'}<ChevronRight size={16} className={`text-[var(--share-muted)] transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} aria-hidden />
        </button>
      </div>
      {open && <Card title="전체 유형" aside={`${summary.types.length}개 유형`}>
        <section aria-label="유형 목록">
          <TypeList key={searchKey} types={summary.types} status={status} onStatusChange={setStatus} onTagClick={onTagClick} />
          <p className="mt-4 text-[11px] leading-relaxed text-[var(--share-muted)]">{ANALYSIS_MIN_APPEARANCES}회·{ANALYSIS_MIN_QUESTIONS}문항 미만은 판정을 보류해요. 여러 유형에 속한 문제는 각 유형에 포함돼요.</p>
        </section>
      </Card>}
    </section>
  )
}

function TypeList({ types, status, onStatusChange, onTagClick }: { types: AnalysisType[]; status: AnalysisStatus | 'all'; onStatusChange: (status: AnalysisStatus | 'all') => void; onTagClick: TagAction }) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const matched = types.filter((type) => (status === 'all' || type.status === status)
    && type.name.toLocaleLowerCase('ko-KR').includes(query.trim().toLocaleLowerCase('ko-KR')))
  const ordered = STATUS_DISPLAY_ORDER.flatMap((group) => matched.filter((type) => type.status === group))
  const shown = expanded ? ordered : ordered.slice(0, 8)
  return (
    <>
      <div className="space-y-2">
        <label className="flex min-h-11 items-center gap-2 rounded-[14px] bg-[var(--share-box-on-card)] px-3 focus-within:outline-2 focus-within:outline-[var(--share-line-strong)]">
          <Search size={15} className="shrink-0 text-[var(--share-muted)]" aria-hidden />
          <input type="search" aria-label="유형 이름 검색" value={query} onChange={(event) => { setQuery(event.target.value); setExpanded(false) }} placeholder="유형 이름으로 찾기" className="min-w-0 flex-1 bg-transparent py-3 text-[13px] outline-none placeholder:text-[var(--share-muted)]" />
        </label>
        <select aria-label="유형 상태 필터" value={status} onChange={(event) => { onStatusChange(event.target.value as AnalysisStatus | 'all'); setExpanded(false) }} className="min-h-11 w-full rounded-[14px] bg-[var(--share-box-on-card)] px-3 text-[13px] font-semibold">
          <option value="all">전체 유형 ({types.length})</option>
          {STATUS_DISPLAY_ORDER.map((group) => <option key={group} value={group}>{ANALYSIS_STATUS_LABELS[group]} ({types.filter((type) => type.status === group).length})</option>)}
        </select>
      </div>
      <p className="mt-3 text-[11px] text-[var(--share-muted)]" role="status">{matched.length}유형{matched.length > shown.length ? ` 중 ${shown.length}유형 표시` : ''}</p>
      {matched.length === 0 && <p className="py-5 text-[13px] text-[var(--share-muted)]">조건에 맞는 유형이 없어요.</p>}
      <div className="mt-4 space-y-5">
        {STATUS_DISPLAY_ORDER.map((group) => {
          const rows = shown.filter((type) => type.status === group)
          if (rows.length === 0) return null
          return <section key={group} aria-label={`${ANALYSIS_STATUS_LABELS[group]} 유형`}>
            <h3 className="mb-1 text-[12px] font-extrabold" style={{ color: group === 'priority' ? T.red : T.body2 }}>{ANALYSIS_STATUS_LABELS[group]}</h3>
            <div className="divide-y divide-[var(--share-line)]">
              {rows.map((type) => {
                const content = <>
                  <span className="flex items-center justify-between gap-3 text-[14px] font-bold">
                    <span className="break-words">{type.name}</span>
                    <span className="flex shrink-0 items-center gap-1 tabular-nums">{type.cumulative.rate}%{type.wrong > 0 && <ChevronRight size={16} className="text-[var(--share-muted)]" aria-hidden />}</span>
                  </span>
                  <span className="mt-1.5 block text-[12px] leading-relaxed text-[var(--share-muted)] tabular-nums">기간 {type.cumulative.correct}/{type.total}문항 정답 · {type.points.length}회 출제</span>
                </>
                return type.wrong > 0
                  ? <button type="button" key={type.id} onClick={() => onTagClick(type.id, type.name)} aria-label={`${type.name} 오답 ${type.wrong}문항 보기`} className={`${PRESS} block min-h-11 w-full py-3 text-left`}>{content}</button>
                  : <div key={type.id} className="py-3">{content}</div>
              })}
            </div>
          </section>
        })}
      </div>
      {matched.length > 8 && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className={`${PRESS} mt-3 min-h-11 text-[13px] font-bold text-[var(--share-blue)]`}>{expanded ? '유형 접기' : `유형 ${matched.length - 8}개 더 보기`}</button>}
    </>
  )
}

function TrendList({ types, model, onTagClick }: { types: AnalysisType[]; model: ShareModel; onTagClick: TagAction }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? types : types.slice(0, 3)
  const label = (id: string) => {
    const week = model.weeks.find((item) => item.id === id)
    return week ? `${getWeekLabel(week)}${week.start_date ? ` · ${fmtWeekLabel(week)}` : ''}` : '회차 미상'
  }
  return (
    <>
      <Card noPad>
        <div className="divide-y divide-[var(--share-line)] px-4">
          {shown.map((type) => {
            const previous = type.points[type.points.length - 2]
            const latest = type.points[type.points.length - 1]
            const delta = latest.rate - previous.rate
            const pattern = model.repeatPatterns.find((item) => item.id === type.id)
            return (
              <div key={type.id} className="py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-bold">{type.name}</h3>
                  <span className="text-[12px] text-[var(--share-muted)] tabular-nums">직전 회차와 {Math.abs(delta)}%p 차이 · 참고</span>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="flex flex-wrap items-center gap-2 text-[23px] font-bold tabular-nums"><span className="font-medium text-[var(--share-muted)]">{previous.rate}%</span><ArrowRight size={16} aria-label="에서" className="text-[var(--share-muted)]" /><span>{latest.rate}%</span></p>
                </div>
                <div className="mt-2 space-y-1 text-[12px] leading-relaxed text-[var(--share-muted)] tabular-nums">
                  <p>{label(previous.weekId)} · {previous.correct}/{previous.total}문항 정답</p>
                  <p>{label(latest.weekId)} · {latest.correct}/{latest.total}문항 정답</p>
                  {(previous.total <= SMALL_SAMPLE_MAX || latest.total <= SMALL_SAMPLE_MAX) && <p>출제 수가 적어 변화는 참고로 봐주세요.</p>}
                </div>
                <details className="mt-2">
                  <summary className="flex min-h-11 cursor-pointer items-center text-[12px] font-semibold text-[var(--share-body2)]">출제 {type.points.length}회 기록 모두 보기</summary>
                  <div className="space-y-2 pb-3 text-[12px] leading-relaxed text-[var(--share-muted)]">
                    <p>기간 누적 정답률 {Math.round((type.total - type.wrong) / type.total * 100)}% · {type.total - type.wrong}/{type.total}문항 정답</p>
                    {pattern && <p>{pattern.patternType === 'persistent'
                      ? `${pattern.weekCount}회 출제 중 ${pattern.wrongWeekCount}회에서 절반 넘게 틀렸어요.`
                      : pattern.patternType === 'unstable'
                        ? `회차별 정답률은 ${Math.min(...pattern.weeks.map((week) => week.accuracy))}%~${Math.max(...pattern.weeks.map((week) => week.accuracy))}%예요.`
                        : `기간 앞부분과 비교해 뒷부분 정답률이 ${Math.abs(pattern.trend)}%p ${pattern.trend > 0 ? '높아요' : '낮아요'}.`}</p>}
                    {type.points.map((point) => <p key={point.weekId} className="tabular-nums">{label(point.weekId)} · {point.correct}/{point.total}문항 정답 · {point.rate}%</p>)}
                  </div>
                </details>
                {type.wrong > 0 && <button type="button" onClick={() => onTagClick(type.id, type.name)} aria-label={`${type.name} 관련 오답 보기`} className={`${PRESS} flex min-h-11 items-center gap-2 text-[13px] font-semibold text-[var(--share-blue)]`}>관련 오답 보기<ArrowRight size={14} aria-hidden /></button>}
              </div>
            )
          })}
        </div>
      </Card>
      {types.length > 3 && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className={`${PRESS} mt-2 min-h-11 text-[13px] font-bold text-[var(--share-blue)]`}>{expanded ? '변화 접기' : `다른 유형 변화 ${types.length - 3}개 보기`}</button>}
    </>
  )
}
