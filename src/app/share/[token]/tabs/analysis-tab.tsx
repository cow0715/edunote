'use client'

import { useState, type ReactNode } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { Card, EmptyNote } from '../share-components'
import { deltaColor, PRESS, T } from '../share-tokens'
import type { ShareModel } from '../use-share-model'
import { fmtWeekLabel, getWeekLabel } from '../share-utils'
import { SMALL_SAMPLE_MAX } from '@/lib/wrong-rate'
import type { AnalysisType } from '@/lib/share-analysis'

type TagAction = (id: string, name: string) => void

export function AnalysisTab({ model, periodLabel, onTagClick, onOpenWrongNote }: {
  model: ShareModel
  periodLabel?: string
  onTagClick: TagAction
  onOpenWrongNote: () => void
}) {
  const { analysisSummary: summary, radarData, radarLegend } = model
  const { focus } = summary
  return (
    <div className="px-1.5 text-[var(--share-ink)]">
      <section className="pt-4 pb-8" aria-label="먼저 살펴볼 내용">
        <p className="text-[12px] leading-relaxed text-[var(--share-muted)] tabular-nums">
          {periodLabel ?? '선택 기간'} 학습 분석 · {summary.weekCount}회차 · {summary.readingCount}문항
        </p>
        <h1 className="mt-4 whitespace-pre-line break-words text-[23px] leading-[1.32] font-bold tracking-[-0.025em]">{summary.headline}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--share-muted)]">{summary.description}</p>
        {focus && (
          <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <span className="text-[15px] font-bold">{focus.name}</span>
            <span className="text-[23px] font-bold tabular-nums">{focus.wrong}<span className="text-[12px] font-medium text-[var(--share-muted)]"> / {focus.total}문항 오답</span></span>
          </div>
        )}
        {summary.wrongCount > 0 && (
          <button type="button" onClick={() => focus ? onTagClick(focus.id, focus.name) : onOpenWrongNote()}
            className={`${PRESS} mt-5 flex min-h-12 w-full items-center justify-between gap-3 rounded-[14px] bg-[var(--control-bg)] px-4 py-3 text-left text-[14px] font-bold text-[var(--control-fg)]`}>
            <span>{focus ? `${focus.name} 오답 확인하기` : `오답 ${summary.wrongCount}문항 확인하기`}</span>
            <ArrowRight size={18} className="shrink-0" aria-hidden />
          </button>
        )}
      </section>
      {summary.types.length > 0 && (
        <AnalysisSection title="어떤 유형에서 틀렸나요?" unit="오답률">
          <TypeList key={periodLabel} types={summary.types} focusId={focus?.id} onTagClick={onTagClick} />
          <p className="mt-4 text-[12px] leading-relaxed text-[var(--share-muted)]">유형이 여러 개인 문제는 각 유형에 포함돼요. 출제 수가 적은 유형은 참고로 봐주세요.</p>
        </AnalysisSection>
      )}
      {summary.untaggedCount > 0 && (
        <p className="pb-5 text-[13px] leading-relaxed text-[var(--share-muted)]">유형이 아직 분류되지 않은 {summary.untaggedCount}문항은 유형·영역 비교에서 제외했어요.</p>
      )}
      {summary.trends.length > 0 ? (
        <AnalysisSection title="출제 회차별로 어떻게 달라졌나요?" unit="정답률">
          <TrendList key={periodLabel} types={summary.trends} model={model} onTagClick={onTagClick} />
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--share-muted)]">같은 유형이 나온 최근 두 회차를 비교했어요. 출제 수와 난도가 다를 수 있어요.</p>
        </AnalysisSection>
      ) : summary.readingCount > 0 && summary.types.length > 0 ? (
        <div className="pb-7"><EmptyNote title="다음 결과가 쌓이면 변화도 볼 수 있어요" hint="같은 유형이 두 회차 이상 출제되면 비교해 드릴게요." /></div>
      ) : null}
      {radarData.length > 0 && (
        <AnalysisSection title="영역별로도 살펴보세요" unit="정답률">
          <div className="space-y-5">
            {radarData.map((area) => (
              <div key={area.name}>
                <div className="flex items-baseline justify-between gap-4 text-[14px]">
                  <span className="font-bold">{area.name}</span><strong className="shrink-0 tabular-nums">{area.rate}%</strong>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--share-box)]" aria-hidden>
                  <div className="h-full rounded-full" style={{ width: `${area.rate}%`, background: T.disabled }} />
                </div>
                <p className="mt-2 text-[12px] text-[var(--share-muted)] tabular-nums">{area.total}문항 중 {area.correct}문항 정답</p>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--share-muted)]">{radarLegend.find((item) => item.name === area.name)?.tags.join(' · ')}</p>
              </div>
            ))}
          </div>
        </AnalysisSection>
      )}
    </div>
  )
}

function AnalysisSection({ title, unit, children }: { title: string; unit: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--share-line)] py-7">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] leading-relaxed font-extrabold">{title}</h2>
        <span className="shrink-0 text-[11px] text-[var(--share-muted)]">{unit}</span>
      </div>
      {children}
    </section>
  )
}

function TypeList({ types, focusId, onTagClick }: { types: AnalysisType[]; focusId?: string; onTagClick: TagAction }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? types : types.slice(0, 8)
  return (
    <>
      <div className="space-y-5">
        {shown.map((type) => {
          const rate = Math.round(type.wrong / type.total * 100)
          const content = <>
            <span className="flex min-h-11 items-center justify-between gap-3 text-[15px] font-bold">
              <span className="break-words">{type.name}</span>
              <span className="flex shrink-0 items-center gap-1 tabular-nums">{rate}%{type.wrong > 0 && <ChevronRight size={16} className="text-[var(--share-muted)]" aria-hidden />}</span>
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--share-box)]" aria-hidden>
              <span className="block h-full rounded-full" style={{ width: `${rate}%`, background: type.id === focusId && type.total > SMALL_SAMPLE_MAX ? T.blue : T.disabled }} />
            </span>
            <span className="mt-2 block text-[12px] text-[var(--share-muted)] tabular-nums">{type.total}문항 중 {type.wrong}문항 오답{type.total <= SMALL_SAMPLE_MAX ? ' · 적은 출제 수' : ''}</span>
          </>
          return type.wrong > 0
            ? <button type="button" key={type.id} onClick={() => onTagClick(type.id, type.name)} aria-label={`${type.name} 오답 ${type.wrong}문항 보기`} className={`${PRESS} block w-full text-left`}>{content}</button>
            : <div key={type.id}>{content}</div>
        })}
      </div>
      {types.length > 8 && <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className={`${PRESS} mt-3 min-h-11 text-[13px] font-bold text-[var(--share-blue)]`}>{expanded ? '유형 접기' : `유형 ${types.length - 8}개 더 보기`}</button>}
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
            const y = (rate: number) => 42 - rate * .32
            const pattern = model.repeatPatterns.find((item) => item.id === type.id)
            return (
              <div key={type.id} className="py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-bold">{type.name}</h3>
                  <span className="text-[12px] tabular-nums" style={{ color: deltaColor(delta) }}>{delta === 0 ? '같은 정답률' : `${delta > 0 ? '상승' : '하락'} ${Math.abs(delta)}%p`}</span>
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="flex flex-wrap items-center gap-2 text-[23px] font-bold tabular-nums"><span className="font-medium text-[var(--share-muted)]">{previous.rate}%</span><ArrowRight size={16} aria-label="에서" className="text-[var(--share-muted)]" /><span>{latest.rate}%</span></p>
                  <svg width="72" height="48" className="shrink-0" aria-hidden>
                    <line x1="6" x2="66" y1={y(previous.rate)} y2={y(latest.rate)} stroke={deltaColor(delta)} strokeWidth="2" />
                    <circle cx="6" cy={y(previous.rate)} r="3" fill={T.disabled} />
                    <circle cx="66" cy={y(latest.rate)} r="4" fill={deltaColor(delta)} />
                  </svg>
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
