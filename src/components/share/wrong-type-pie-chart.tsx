'use client'

import { useState } from 'react'
import { PieChart, Pie, Cell } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { statusColor } from '@/lib/chart-colors'

type TypeItem = { id: string; name: string; wrong: number; total: number }

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#f87171',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
  '#f97316', '#14b8a6', '#a78bfa', '#fb923c',
]

const MAX_SLICES = 7

// ChartConfig는 키가 정해져야 해서 동적으로 생성
function buildConfig(names: string[]): ChartConfig {
  return Object.fromEntries(
    names.map((name, i) => [name, { label: name, color: COLORS[i % COLORS.length] }])
  ) as ChartConfig
}

function CustomTooltip({ active, payload, isDark }: {
  active?: boolean
  payload?: { name: string; value: number; payload: { id: string; name: string; value: number } }[]
  isDark?: boolean
}) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  const bg     = isDark ? '#1e1e2e' : '#ffffff'
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const text   = isDark ? '#f1f5f9' : '#0f172a'
  const sub    = isDark ? '#94a3b8' : '#64748b'

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: text, marginBottom: 2 }}>{d.payload.name}</p>
      <p style={{ fontSize: 11, color: sub }}>오답 <span style={{ fontWeight: 700, color: text }}>{d.value}개</span></p>
    </div>
  )
}

export function WrongTypePieChart({ data, onTagClick, isDark }: {
  data: TypeItem[]
  onTagClick?: (id: string, name: string) => void
  isDark?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

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

  const chartConfig = buildConfig(pieData.map((d) => d.name))

  return (
    <div>
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
        <PieChart>
          <defs>
            {pieData.map((_, i) => (
              <radialGradient key={i} id={`pie-grad-${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={1} />
                <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.75} />
              </radialGradient>
            ))}
          </defs>
          <Pie
            data={pieData}
            cx="50%" cy="50%"
            innerRadius={50} outerRadius={76}
            paddingAngle={2.5} dataKey="value"
            strokeWidth={0}
            style={{ cursor: 'pointer' }}
            onClick={(d: { id?: string; name?: string } | null) => {
              if (!d) return
              if (d.id === '__rest__') { setExpanded(true); return }
              if (d.id && d.name && onTagClick) onTagClick(d.id, d.name)
            }}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={`url(#pie-grad-${i})`} />
            ))}
          </Pie>
          <ChartTooltip content={<CustomTooltip isDark={isDark} />} />
        </PieChart>
      </ChartContainer>

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
          <button type="button" onClick={() => setExpanded(false)} className="flex items-center gap-1">
            <span className="text-[11px] text-blue-500 dark:text-blue-400 hover:underline">접기</span>
          </button>
        )}
      </div>
    </div>
  )
}
