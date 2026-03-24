'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

export type HomeworkItem = { label: string; rate: number; done: number; total: number }

export function HomeworkBarChart({ data, isDark }: { data: HomeworkItem[]; isDark?: boolean }) {
  const grid     = isDark ? 'rgba(255,255,255,0.1)'  : '#f0f0f0'
  const tick     = isDark ? '#d1d5db'                : '#9ca3af'   // 다크: gray-300
  const ttBg     = isDark ? '#1c1c2a'                : '#ffffff'
  const ttBorder = isDark ? '#374151'                : '#e5e7eb'
  const ttColor  = isDark ? '#f3f4f6'                : '#111827'

  // 다크: amber-400/300/200 계열 (밝게), 라이트: amber-400/300/200
  const barColor = (rate: number) =>
    isDark
      ? rate >= 80 ? '#fbbf24' : rate >= 50 ? '#fcd34d' : '#fde68a'
      : rate >= 80 ? '#f59e0b' : rate >= 50 ? '#fcd34d' : '#fde68a'

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: tick }} unit="%" axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v: number | string | undefined, _: unknown, props: any) => [
            `${props.payload?.done ?? 0}/${props.payload?.total ?? 0} (${v ?? 0}%)`, '과제',
          ]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${ttBorder}`, backgroundColor: ttBg, color: ttColor }}
        />
        <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((entry, i) => (
            <Cell key={i} fill={barColor(entry.rate)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
