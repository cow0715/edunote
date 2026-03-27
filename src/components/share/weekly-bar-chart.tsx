'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts'
import { ChartContainer, ChartTooltip, ChartLegend, ChartLegendContent, type ChartConfig } from '@/components/ui/chart'

export type WeeklyBarItem = {
  label: string
  단어?: number
  숙제?: number
}

const chartConfig = {
  단어: { label: '단어', color: '#10b981' },
  숙제: { label: '숙제', color: '#f59e0b' },
} satisfies ChartConfig

function CustomTooltip({ active, payload, label, isDark }: {
  active?: boolean
  payload?: { dataKey: string; value: number; color: string }[]
  label?: string
  isDark?: boolean
}) {
  if (!active || !payload?.length) return null
  const bg     = isDark ? '#1e1e2e' : '#ffffff'
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const text   = isDark ? '#f1f5f9' : '#0f172a'
  const sub    = isDark ? '#94a3b8' : '#64748b'

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', minWidth: 110 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: text, marginBottom: 6 }}>{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 2 }}>
          <span style={{ fontSize: 11, color: sub }}>{p.dataKey}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: p.color }}>{p.value}%</span>
        </div>
      ))}
    </div>
  )
}

export function WeeklyBarChart({ data, isDark }: { data: WeeklyBarItem[]; isDark?: boolean }) {
  const hasVocab    = data.some((d) => d.단어 !== undefined)
  const hasHomework = data.some((d) => d.숙제 !== undefined)
  const grid   = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const tick   = isDark ? '#64748b' : '#94a3b8'
  const label  = isDark ? '#94a3b8' : '#6b7280'

  return (
    <ChartContainer config={chartConfig} className="h-[190px] w-full">
      <BarChart data={data} margin={{ top: 18, right: 8, left: -16, bottom: 0 }} barGap={4}>
        <defs>
          <linearGradient id="gradVocab" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
          </linearGradient>
          <linearGradient id="gradHomework" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.5} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: tick }} unit="%" domain={[0, 100]} axisLine={false} tickLine={false} />
        <ChartTooltip content={<CustomTooltip isDark={isDark} />} />
        <ChartLegend content={<ChartLegendContent />} />
        {hasVocab && (
          <Bar dataKey="단어" fill="url(#gradVocab)" radius={[5, 5, 0, 0]} maxBarSize={28}>
            <LabelList dataKey="단어" position="top" style={{ fontSize: 10, fill: label, fontWeight: 600 }} formatter={(v) => v != null ? `${v}%` : ''} />
          </Bar>
        )}
        {hasHomework && (
          <Bar dataKey="숙제" fill="url(#gradHomework)" radius={[5, 5, 0, 0]} maxBarSize={28}>
            <LabelList dataKey="숙제" position="top" style={{ fontSize: 10, fill: label, fontWeight: 600 }} formatter={(v) => v != null ? `${v}%` : ''} />
          </Bar>
        )}
      </BarChart>
    </ChartContainer>
  )
}
