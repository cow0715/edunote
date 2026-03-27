'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { wrongColor } from '@/lib/chart-colors'

type TypeItem = {
  name: string
  rate: number
  wrong: number
  total: number
}

const chartConfig = {
  rate: { label: '오답률', color: '#f87171' },
} satisfies ChartConfig

function CustomTooltip({ active, payload, isDark }: {
  active?: boolean
  payload?: { payload: TypeItem }[]
  isDark?: boolean
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const bg     = isDark ? '#1e1e2e' : '#ffffff'
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const text   = isDark ? '#f1f5f9' : '#0f172a'
  const sub    = isDark ? '#94a3b8' : '#64748b'
  const accent = wrongColor(0, isDark)

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: text, marginBottom: 4 }}>{d.name}</p>
      <p style={{ fontSize: 11, color: sub }}>오답률 <span style={{ fontWeight: 700, color: accent }}>{d.rate}%</span></p>
      <p style={{ fontSize: 11, color: sub }}>{d.wrong} / {d.total} 회</p>
    </div>
  )
}

const barColor = (index: number, isDark?: boolean) => wrongColor(index, isDark)

export function ConceptWeakChart({ data, isDark }: { data: TypeItem[]; isDark?: boolean }) {
  const grid  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const tick  = isDark ? '#64748b' : '#94a3b8'
  const label = isDark ? '#94a3b8' : '#6b7280'

  return (
    <ChartContainer config={chartConfig} style={{ height: Math.max(180, data.length * 40) }} className="w-full">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 10, bottom: 0 }}>
        <defs>
          {data.map((_, i) => {
            const c = barColor(i, isDark)
            return (
              <linearGradient key={i} id={`weak-grad-${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor={c} stopOpacity={1} />
                <stop offset="100%" stopColor={c} stopOpacity={0.5} />
              </linearGradient>
            )
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: tick }} unit="%" domain={[0, 100]} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: tick }} width={72} axisLine={false} tickLine={false} />
        <ChartTooltip content={<CustomTooltip isDark={isDark} />} />
        <Bar dataKey="rate" radius={[0, 5, 5, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={`url(#weak-grad-${i})`} />
          ))}
          <LabelList dataKey="rate" position="right" style={{ fontSize: 10, fill: label, fontWeight: 600 }} formatter={(v) => v != null ? `${v}%` : ''} />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
