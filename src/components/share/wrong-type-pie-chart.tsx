'use client'

import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

type TypeItem = { id: string; name: string; wrong: number; total: number }

const COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#4ade80',
  '#34d399', '#38bdf8', '#818cf8', '#e879f9',
  '#f472b6', '#a78bfa',
  '#c084fc', '#f9a8d4', '#86efac', '#7dd3fc', '#fde68a',
]

const MAX_SLICES = 7

export function WrongTypePieChart({ data, onTagClick, isDark }: {
  data: TypeItem[]
  onTagClick?: (id: string, name: string) => void
  isDark?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const ttBg     = isDark ? '#1c1c2a' : '#ffffff'
  const ttBorder = isDark ? '#374151' : '#e5e7eb'
  const ttColor  = isDark ? '#f3f4f6' : '#111827'

  const sorted = data.filter((d) => d.wrong > 0).sort((a, b) => b.wrong - a.wrong)
  if (sorted.length === 0) return (
    <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-400">오답 데이터가 없습니다</p>
  )

  const hasRest = sorted.length > MAX_SLICES

  const pieData = expanded
    ? sorted.map((d) => ({ id: d.id, name: d.name, value: d.wrong }))
    : [
        ...sorted.slice(0, MAX_SLICES).map((d) => ({ id: d.id, name: d.name, value: d.wrong })),
        ...(hasRest ? [{ id: '__rest__', name: '기타', value: sorted.slice(MAX_SLICES).reduce((s, d) => s + d.wrong, 0) }] : []),
      ]

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%" cy="50%"
            innerRadius={46} outerRadius={72}
            paddingAngle={2} dataKey="value"
            style={{ cursor: 'pointer' }}
            onClick={(d) => {
              if (!d) return
              if (d.id === '__rest__') { setExpanded(true); return }
              if (d.id && onTagClick) onTagClick(d.id, d.name)
            }}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [`${value}개`, name]}
            labelStyle={{ fontSize: 12, color: ttColor }}
            itemStyle={{ color: ttColor }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${ttBorder}`, backgroundColor: ttBg, color: ttColor }}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
        {pieData.map((d, i) => (
          <button
            key={d.name}
            type="button"
            disabled={d.id !== '__rest__' && (!d.id || !onTagClick)}
            onClick={() => {
              if (d.id === '__rest__') { setExpanded(true); return }
              if (d.id && onTagClick) onTagClick(d.id, d.name)
            }}
            className="flex items-center gap-1 disabled:cursor-default"
          >
            <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className={`text-[11px] ${
              d.id === '__rest__'
                ? 'text-blue-500 dark:text-blue-400 hover:underline'
                : d.id && onTagClick
                  ? 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:underline'
                  : 'text-gray-400 dark:text-gray-400'
            }`}>
              {d.id === '__rest__' ? '기타 (펼치기)' : d.name}
            </span>
          </button>
        ))}
        {expanded && hasRest && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1"
          >
            <span className="text-[11px] text-blue-500 dark:text-blue-400 hover:underline">접기</span>
          </button>
        )}
      </div>
    </div>
  )
}
