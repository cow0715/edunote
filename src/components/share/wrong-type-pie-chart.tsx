'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

type TypeItem = { name: string; wrong: number; total: number }

const COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#4ade80',
  '#34d399', '#38bdf8', '#818cf8', '#e879f9',
  '#f472b6', '#a78bfa',
]

const MAX_SLICES = 7

export function WrongTypePieChart({ data }: { data: TypeItem[] }) {
  const sorted = data.filter((d) => d.wrong > 0).sort((a, b) => b.wrong - a.wrong)
  if (sorted.length === 0) return <p className="py-8 text-center text-xs text-gray-400">오답 데이터가 없습니다</p>

  // 상위 MAX_SLICES개 + 나머지 '기타'로 합산
  const top = sorted.slice(0, MAX_SLICES)
  const rest = sorted.slice(MAX_SLICES)
  const pieData = [
    ...top.map((d) => ({ name: d.name, value: d.wrong })),
    ...(rest.length > 0 ? [{ name: '기타', value: rest.reduce((s, d) => s + d.wrong, 0) }] : []),
  ]

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={46}
            outerRadius={72}
            paddingAngle={2}
            dataKey="value"
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [`${value}개`, name]}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* 커스텀 범례 — flex-wrap으로 잘림 없음 */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
        {pieData.map((d, i) => (
          <div key={d.name} className="flex items-center gap-1">
            <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="text-[11px] text-gray-500">{d.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
