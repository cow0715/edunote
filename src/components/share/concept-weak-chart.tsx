'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

type TypeItem = {
  name: string
  rate: number
  wrong: number
  total: number
}

export function ConceptWeakChart({ data }: { data: TypeItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={70} />
        <Tooltip
          formatter={(value, _name, props) => [
            `${value}% 오답률 (${props.payload.wrong}/${props.payload.total}회)`,
            '오답률',
          ]}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={i < 3 ? '#f87171' : '#fbbf24'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
