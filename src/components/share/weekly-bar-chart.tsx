'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

export type WeeklyBarItem = {
  label: string
  단어?: number
  숙제?: number
}

export function WeeklyBarChart({ data }: { data: WeeklyBarItem[] }) {
  const hasVocab = data.some((d) => d.단어 !== undefined)
  const hasHomework = data.some((d) => d.숙제 !== undefined)

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
        <Tooltip formatter={(v) => `${v}%`} contentStyle={{ fontSize: 12 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        {hasVocab && <Bar dataKey="단어" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={24} />}
        {hasHomework && <Bar dataKey="숙제" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={24} />}
      </BarChart>
    </ResponsiveContainer>
  )
}
