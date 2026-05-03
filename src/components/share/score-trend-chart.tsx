'use client'

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Cell, LabelList, ReferenceLine } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'

export type TrendItem = {
  label: string
  readingRate: number | null
  vocabRate: number | null
  classReadingRate: number | null
  classVocabRate: number | null
}

const ALL_SERIES = [
  { key: 'readingRate', classKey: 'classReadingRate', label: '시험', color: '#6366f1', classColor: '#a5b4fc', darkColor: '#818cf8', darkClassColor: '#6366f155' },
  { key: 'vocabRate',   classKey: 'classVocabRate',   label: '단어', color: '#10b981', classColor: '#6ee7b7', darkColor: '#34d399', darkClassColor: '#10b98155' },
] as const

const chartConfig = {
  readingRate:      { label: '시험',      color: '#6366f1' },
  classReadingRate: { label: '반평균 시험', color: '#a5b4fc' },
  vocabRate:        { label: '단어',      color: '#10b981' },
  classVocabRate:   { label: '반평균 단어', color: '#6ee7b7' },
} satisfies ChartConfig

const scoreColor = (rate: number, series: 'reading' | 'vocab', isDark?: boolean) => {
  if (series === 'vocab') {
    if (rate >= 80) return isDark ? '#34d399' : '#10b981'
    if (rate >= 60) return isDark ? '#fbbf24' : '#f59e0b'
    return '#f87171'
  }
  if (rate >= 80) return isDark ? '#818cf8' : '#6366f1'
  if (rate >= 60) return isDark ? '#fbbf24' : '#f59e0b'
  return '#f87171'
}

function CustomTooltip({ active, payload, label, isDark }: {
  active?: boolean
  payload?: { dataKey: string; value: number | null; color: string }[]
  label?: string
  isDark?: boolean
}) {
  if (!active || !payload?.length) return null
  const bg     = isDark ? '#1e1e2e' : '#ffffff'
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const text   = isDark ? '#f1f5f9' : '#0f172a'
  const sub    = isDark ? '#94a3b8' : '#64748b'

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', minWidth: 130 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: text, marginBottom: 6 }}>{label}</p>
      {payload.map((p) => {
        if (p.value === null) return null
        const s = ALL_SERIES.find((s) => s.key === p.dataKey || s.classKey === p.dataKey)
        const isClass = ALL_SERIES.some((s) => s.classKey === p.dataKey)
        return (
          <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
            <span style={{ fontSize: 11, color: sub }}>{isClass ? `반평균 ${s?.label}` : '내 점수'}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: p.color }}>{p.value}%</span>
          </div>
        )
      })}
    </div>
  )
}

export function ScoreTrendChart({ data, isDark, series }: { data: TrendItem[]; isDark?: boolean; series?: 'reading' | 'vocab' }) {
  const currentSeries = series === 'vocab' ? ALL_SERIES[1] : ALL_SERIES[0]
  const dataKey = currentSeries.key
  const classKey = currentSeries.classKey
  const grid = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const tick = isDark ? '#94A3B8' : '#8B95A1'
  const label = isDark ? '#94a3b8' : '#6b7280'

  return (
    <div>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <ComposedChart data={data} margin={{ top: 18, right: 8, left: -24, bottom: 0 }}>
          <defs>
            {data.map((d, i) => {
              const rate = d[dataKey] ?? 0
              const color = scoreColor(rate, series ?? 'reading', isDark)
              return (
                <linearGradient key={i} id={`score-grad-${dataKey}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={1} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.5} />
                </linearGradient>
              )
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: tick }} unit="%" axisLine={false} tickLine={false} />
          <ChartTooltip content={<CustomTooltip isDark={isDark} />} />
          <ReferenceLine y={80} stroke={isDark ? 'rgba(255,255,255,0.12)' : 'rgba(36,99,235,0.16)'} strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey={classKey}
            stroke={isDark ? currentSeries.darkClassColor : currentSeries.classColor}
            strokeWidth={1.6}
            strokeDasharray="5 4"
            dot={false}
            connectNulls
          />
          <Bar dataKey={dataKey} radius={[5, 5, 0, 0]} maxBarSize={40}>
            {data.map((d, i) => (
              <Cell key={i} fill={d[dataKey] === null ? 'transparent' : `url(#score-grad-${dataKey}-${i})`} />
            ))}
            <LabelList dataKey={dataKey} position="top" style={{ fontSize: 10, fill: label, fontWeight: 600 }} formatter={(v) => v != null ? `${v}%` : ''} />
          </Bar>
        </ComposedChart>
      </ChartContainer>

      <div className="mt-2 flex flex-wrap justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: isDark ? currentSeries.darkColor : currentSeries.color }} />
          <span className="text-xs text-gray-500 dark:text-gray-400">내 점수</span>
        </div>
        {data.some((d) => d[classKey] !== null) && (
          <div className="flex items-center gap-1.5">
            <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={isDark ? currentSeries.darkClassColor : currentSeries.classColor} strokeWidth="1.5" strokeDasharray="4 3" /></svg>
            <span className="text-xs text-gray-400 dark:text-gray-500">반평균</span>
          </div>
        )}
      </div>
    </div>
  )
}
