'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

type TrendItem = {
  label: string
  rate: number
  correct: number
  total: number
}

const getColor = (rate: number) =>
  rate >= 80 ? '#22c55e' : rate >= 60 ? '#f59e0b' : '#f87171'

export function ScoreTrendChart({ data }: { data: TrendItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
        <Tooltip
          formatter={(value) => [`${value}%`, '정답률']}
          labelStyle={{ fontSize: 12 }}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={getColor(d.rate)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
