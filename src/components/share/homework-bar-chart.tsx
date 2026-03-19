'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

export type HomeworkItem = { label: string; rate: number; done: number; total: number }

export function HomeworkBarChart({ data }: { data: HomeworkItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v: number | string | undefined, _: unknown, props: any) => [
            `${props.payload?.done ?? 0}/${props.payload?.total ?? 0} (${v ?? 0}%)`, '과제',
          ]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.rate >= 80 ? '#f59e0b' : entry.rate >= 50 ? '#fcd34d' : '#fde68a'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
