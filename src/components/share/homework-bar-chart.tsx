'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { homeworkColor } from '@/lib/chart-colors'

export type HomeworkItem = { label: string; rate: number; done: number; total: number }

const chartConfig = {
  rate: { label: '과제 완료율', color: '#f59e0b' },
} satisfies ChartConfig

function CustomTooltip({ active, payload, label, isDark }: {
  active?: boolean
  payload?: { value: number; payload: HomeworkItem }[]
  label?: string
  isDark?: boolean
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const bg     = isDark ? '#1E293B' : '#FFFFFF'
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const text   = isDark ? '#F8FAFC' : '#1A1C1E'
  const sub    = isDark ? '#94A3B8' : '#8B95A1'
  const accent = homeworkColor(d.rate, isDark)

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: text, marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 11, color: sub }}>완료율 <span style={{ fontWeight: 700, color: accent }}>{d.rate}%</span></p>
      <p style={{ fontSize: 11, color: sub }}>{d.done} / {d.total} 명</p>
    </div>
  )
}

const barColor = (rate: number, isDark?: boolean) => homeworkColor(rate, isDark)

export function HomeworkBarChart({ data, isDark }: { data: HomeworkItem[]; isDark?: boolean }) {
  const grid  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const tick  = isDark ? '#64748b' : '#94a3b8'
  const label = isDark ? '#94a3b8' : '#6b7280'

  return (
    <ChartContainer config={chartConfig} className="h-[175px] w-full">
      <BarChart data={data} margin={{ top: 18, right: 8, left: -24, bottom: 0 }}>
        <defs>
          {data.map((d, i) => {
            const c = barColor(d.rate, isDark)
            return (
              <linearGradient key={i} id={`hw-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={c} stopOpacity={1} />
                <stop offset="100%" stopColor={c} stopOpacity={0.5} />
              </linearGradient>
            )
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: tick }} unit="%" axisLine={false} tickLine={false} />
        <ChartTooltip content={<CustomTooltip isDark={isDark} />} />
        <Bar dataKey="rate" radius={[5, 5, 0, 0]} maxBarSize={40}>
          {data.map((d, i) => (
            <Cell key={i} fill={`url(#hw-grad-${i})`} />
          ))}
          <LabelList dataKey="rate" position="top" style={{ fontSize: 10, fill: label, fontWeight: 600 }} formatter={(v) => v != null ? `${v}%` : ''} />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
