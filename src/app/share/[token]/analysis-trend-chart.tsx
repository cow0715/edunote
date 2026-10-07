'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ANALYSIS_MIN_APPEARANCES, ANALYSIS_MIN_QUESTIONS, ANALYSIS_STATUS_LABELS, type AnalysisPoint, type AnalysisStatus, type AnalysisType } from '@/lib/share-analysis'
import { SMALL_SAMPLE_MAX } from '@/lib/wrong-rate'
import type { Week } from './share-types'
import { fmtWeekLabel, getWeekLabel } from './share-utils'
import { Segmented } from './share-ui'
import { deltaColor, PRESS, T } from './share-tokens'

const VISIBLE_APPEARANCES = 6
const INITIAL_CHART_SIZE = { width: 320, height: 196 }
const STATUS_DISPLAY_ORDER: AnalysisStatus[] = ['priority', 'review', 'stable', 'insufficient']

export function AnalysisTrendChart({ types, allTypes, weeks, onTagClick, improvementId, strengthId }: {
  types: AnalysisType[]
  allTypes?: AnalysisType[]
  weeks: Week[]
  onTagClick: (id: string, name: string) => void
  improvementId?: string
  strengthId?: string
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const availableTypes = allTypes ?? types
  const selected = availableTypes.find((type) => type.id === selectedId) ?? types[0] ?? availableTypes[0]
  if (!selected || selected.points.length === 0) return null

  const points = selected.points.slice(-VISIBLE_APPEARANCES)
  const latest = points.at(-1)!
  const canCompare = selected.trendComparable && selected.change !== null
  const latestColor = canCompare ? deltaColor(selected.change) : T.body2
  const weekById = new Map(weeks.map((week) => [week.id, week]))
  const pointLabel = (weekId: string, index: number, short = false) => {
    const week = weekById.get(weekId)
    if (!week) return `${index + 1}번째 출제`
    if (short) return week.start_date ? fmtWeekLabel(week) : getWeekLabel(week)
    return `${getWeekLabel(week)}${week.start_date ? ` · ${fmtWeekLabel(week)}` : ''}`
  }
  const { recentCount, previousCount } = selected
  const role = selected.id === improvementId ? '최근에 나아진 유형'
    : selected.id === strengthId ? '잘 풀고 있는 유형'
      : ANALYSIS_STATUS_LABELS[selected.status]
  const showRole = availableTypes.length <= 3 || selected.id === improvementId || selected.id === strengthId
  const firstPointIndex = selected.points.length - points.length
  const chartData = points.map((point, index) => ({
    ...point,
    label: pointLabel(point.weekId, firstPointIndex + index),
    axisLabel: pointLabel(point.weekId, firstPointIndex + index, true),
  }))
  const chartTitle = `${selected.name} 정답률, ${selected.points.length > VISIBLE_APPEARANCES ? '최근 6회 ' : ''}출제 회차 순: ${points.map((point) => `${point.rate}%`).join(' → ')}`
  const endpointTicks = points.length === 1 ? [latest.weekId] : [points[0].weekId, latest.weekId]

  return (
    <div className="min-w-0">
      <p className="mb-2 text-[11px]" style={{ color: T.muted }}>유형 분류 · 선택 기간 누적 기준</p>
      {availableTypes.length > 3 ? (
        <select
          aria-label="정답률 그래프 유형 선택" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}
          className="min-h-11 w-full min-w-0 rounded-[14px] px-3 text-[13px] font-semibold"
          style={{ background: T.control, color: T.onControl }}
        >
          {STATUS_DISPLAY_ORDER.map((status) => {
            const options = availableTypes.filter((type) => type.status === status)
            return options.length > 0 && (
              <optgroup key={status} label={ANALYSIS_STATUS_LABELS[status]}>
                {options.map((type) => <option key={type.id} value={type.id}>{type.name} · {ANALYSIS_STATUS_LABELS[status]}</option>)}
              </optgroup>
            )
          })}
        </select>
      ) : <div className="pb-1 [&>div]:flex [&>div]:w-full [&_button]:min-h-11 [&_button]:min-w-0 [&_button]:flex-1" role="group" aria-label="정답률 추이를 볼 유형">
        <Segmented value={selected.id} size="sm" onChange={setSelectedId} options={availableTypes.map((type) => ({
          value: type.id,
          label: (
            <span className="block max-w-[90px]" title={type.name}>
              <span className="block truncate">{type.name}</span>
              {type.id === improvementId && <span aria-hidden="true" className="block text-[10px] font-semibold" style={{ color: T.muted }}>개선 ↑</span>}
              {type.id === strengthId && <span aria-hidden="true" className="block text-[10px] font-semibold" style={{ color: T.muted }}>강점</span>}
            </span>
          ),
        }))} />
      </div>}

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11px]" style={{ color: T.muted }}>
          <p>최근 {recentCount}회 합산 정답률</p>
          {showRole && <p className="font-semibold">{role}</p>}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
          <strong className="text-[20px] font-extrabold" style={{ color: T.ink }}>{selected.recent.rate}%</strong>
          <span className="text-[12px]" style={{ color: T.body }}>{selected.recent.correct}/{selected.recent.total}문항 정답</span>
          {canCompare && (
            <span className="text-[11px]" style={{ color: deltaColor(selected.change) }}>
              직전 {previousCount}회 대비 {selected.change! > 0 ? '+' : ''}{selected.change}%p
            </span>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px]" style={{ color: T.muted }}>
        {'회차별 정답률 · '}
        {selected.points.length > VISIBLE_APPEARANCES ? `최근 ${VISIBLE_APPEARANCES}회 출제 · 전체 ${selected.points.length}회` : `${selected.points.length}회 출제`}
      </p>
      <div className="mt-1 min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height={196} minWidth={0} initialDimension={INITIAL_CHART_SIZE}>
          <LineChart
            key={selected.id} data={chartData} margin={{ top: 16, right: 42, bottom: 2, left: 0 }}
            accessibilityLayer role="img" title={chartTitle}
            desc="정답률 축은 0%부터 100%까지 고정돼요. 그래프를 누르거나 방향키로 회차별 문항 수를 확인할 수 있어요."
          >
            <CartesianGrid vertical={false} stroke={T.lineStrong} />
            <XAxis
              dataKey="weekId" type="category" ticks={endpointTicks} height={26}
              axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: T.muted }}
              interval="preserveStartEnd" minTickGap={12}
              tickFormatter={(weekId: string) => {
                const label = chartData.find((point) => point.weekId === weekId)?.axisLabel ?? ''
                return label.length > 6 ? `${label.slice(0, 5)}…` : label
              }}
            />
            <YAxis
              domain={[0, 100]} ticks={[0, 50, 100]} width={40}
              axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: T.muted }}
              tickFormatter={(rate: number) => `${rate}%`}
            />
            <Tooltip
              trigger="click" isAnimationActive={false} cursor={{ stroke: T.lineStrong }}
              contentStyle={{ background: T.box, border: 0, borderRadius: 12, fontSize: 12, color: T.body,
                maxWidth: 'min(240px, calc(100vw - 64px))', whiteSpace: 'normal', overflowWrap: 'anywhere' }}
              labelStyle={{ color: T.muted, fontSize: 11, marginBottom: 4 }}
              itemStyle={{ color: T.body2, padding: 0 }}
              labelFormatter={(weekId) => chartData.find((point) => point.weekId === weekId)?.label ?? '출제 회차'}
              formatter={(_value, _name, entry) => {
                const point = entry.payload as AnalysisPoint
                return [`${point.rate}% · ${point.correct}/${point.total}문항 정답`, '정답률']
              }}
            />
            <Line
              type="linear" dataKey="rate" name="정답률" stroke={T.body2} strokeWidth={2}
              dot={{ r: 3.5, fill: T.body2, stroke: T.card, strokeWidth: 1.5 }}
              activeDot={{ r: 5, fill: T.body2, stroke: T.card, strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <ReferenceDot
              x={latest.weekId} y={latest.rate} r={4.5} fill={latestColor} stroke={T.card} strokeWidth={1.5}
              label={{ value: `${latest.rate}%`, position: 'right', offset: 9, fill: latestColor, fontSize: 11, fontWeight: 700 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: T.muted }}>
        {!canCompare
          ? `변화 비교는 최근·직전 묶음이 각각 ${ANALYSIS_MIN_APPEARANCES}회·${ANALYSIS_MIN_QUESTIONS}문항 이상일 때 보여드려요.`
          : points.some((point) => point.total <= SMALL_SAMPLE_MAX)
          ? '출제 수가 적은 회차가 있어 변화는 참고로 봐주세요.'
          : '회차마다 출제 수와 난도가 다를 수 있어요.'}
      </p>

      <details className="mt-3 text-[11px]" style={{ color: T.muted }}>
        <summary className={`${PRESS} min-h-11 cursor-pointer py-3 font-semibold`}>회차별 수치 보기</summary>
        <ul className="mt-2 space-y-2">
          {selected.points.map((point, index) => (
            <li key={point.weekId} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
              <span className="min-w-0 break-words">{pointLabel(point.weekId, index)}</span>
              <span className="tabular-nums" style={{ color: T.body2 }}>{point.correct}/{point.total}문항 정답 · {point.rate}%</span>
            </li>
          ))}
        </ul>
      </details>

      {selected.wrong > 0 && (
        <button
          type="button" aria-label={`${selected.name} 오답 ${selected.wrong}문항 보기`} onClick={() => onTagClick(selected.id, selected.name)}
          className={`${PRESS} mt-4 flex w-full items-center justify-center gap-2 rounded-[14px] px-4 py-3 text-[13px] font-extrabold`}
          style={{ background: T.control, color: T.onControl }}
        >
          오답 {selected.wrong}문항 보기 <ArrowRight size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
