'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

type TypeItem = { name: string; wrong: number; total: number }

const COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635',
  '#34d399', '#38bdf8', '#818cf8', '#e879f9',
]

export function WrongTypePieChart({ data }: { data: TypeItem[] }) {
  const pieData = data.filter((d) => d.wrong > 0).map((d) => ({ name: d.name, value: d.wrong }))
  if (pieData.length === 0) return <p className="py-8 text-center text-xs text-gray-400">오답 데이터가 없습니다</p>

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
        >
          {pieData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value, name) => [`${value}개`, name]} contentStyle={{ fontSize: 12 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
