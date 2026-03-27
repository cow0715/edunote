'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'
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
            <span style={{ fontSize: 11, color: sub }}>{isClass ? `반평균 ${s?.label}` : s?.label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: p.color }}>{p.value}%</span>
          </div>
        )
      })}
    </div>
  )
}

export function ScoreTrendChart({ data, isDark, series }: { data: TrendItem[]; isDark?: boolean; series?: 'reading' | 'vocab' }) {
  const SERIES = series === 'reading' ? [ALL_SERIES[0]]
    : series === 'vocab' ? [ALL_SERIES[1]]
    : ALL_SERIES
  const grid = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const tick = isDark ? '#64748b' : '#94a3b8'
  const bg   = isDark ? '#1e1e2e' : '#ffffff'

  return (
    <div>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 4 }}>
          <defs>
            {SERIES.map((s) => {
              const solid = isDark ? s.darkColor : s.color
              return (
                <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={solid} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={solid} stopOpacity={0.02} />
                </linearGradient>
              )
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: tick }} unit="%" axisLine={false} tickLine={false} />
          <ChartTooltip content={<CustomTooltip isDark={isDark} />} />
          {SERIES.flatMap((s) => {
            const solid = isDark ? s.darkColor : s.color
            const dash  = isDark ? s.darkClassColor : s.classColor
            return [
              /* 반평균 — 점선, 면적 없음 */
              <Area key={s.classKey} type="monotone" dataKey={s.classKey}
                stroke={dash} strokeWidth={1.5} strokeDasharray="5 4"
                fill="none" dot={false} connectNulls />,
              /* 본인 — 면적 + 강조 dot */
              <Area key={s.key} type="monotone" dataKey={s.key}
                stroke={solid} strokeWidth={2.5}
                fill={`url(#area-${s.key})`}
                dot={{ r: 4, fill: solid, strokeWidth: 2, stroke: bg }}
                activeDot={{ r: 6, fill: solid, strokeWidth: 2, stroke: bg }}
                connectNulls />,
            ]
          })}
        </AreaChart>
      </ChartContainer>

      <div className="mt-2 flex flex-wrap justify-center gap-4">
        {SERIES.map((s) => {
          const solid = isDark ? s.darkColor : s.color
          const dash  = isDark ? s.darkClassColor : s.classColor
          return (
            <div key={s.key} className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: solid }} />
                <span className="text-xs text-gray-500 dark:text-gray-400">{s.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={dash} strokeWidth="1.5" strokeDasharray="4 3" /></svg>
                <span className="text-xs text-gray-400 dark:text-gray-500">반평균</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
