'use client'

// 유형별 오답 — 도넛(오답 횟수) + 범례(오답률·표본).
//
// 두 가지를 같이 답해야 해서 한 화면에 둘을 겹쳐 둔다:
//   · 도넛 조각 크기 = 오답 "횟수" → "내 오답이 어디에 몰려 있나"
//     (비율은 합이 100% 가 안 되므로 조각 크기로 못 쓴다)
//   · 범례의 % 와 막대 = 오답 "률"  → "그 유형을 얼마나 틀리나"
//
// 순서는 Wilson 하한(lib/wrong-rate)으로 정한다. 단순 오답률로 세우면 1문항짜리가
// 전부 위로 올라오는데, 운영 데이터에서 "학생 × 태그" 조합의 절반이 3문항 이하다.
// 표본이 작은 유형은 회색으로 눌러 "아직 판단 이름" 을 드러낸다.

import { useState } from 'react'
import { PieChart, Pie, Cell } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { SMALL_SAMPLE_MAX, sortByWeakness, type WrongTypeStat } from '@/lib/wrong-rate'

const COLORS_LIGHT = [
  '#FDA4AF', '#93C5FD', '#FCD34D', '#6EE7B7',
  '#C4B5FD', '#67E8F9', '#F9A8D4', '#BEF264',
  '#FDE68A', '#99F6E4', '#DDD6FE', '#FED7AA',
]
const COLORS_DARK = [
  '#DC2626', '#4F46E5', '#D97706', '#059669',
  '#7C3AED', '#0891B2', '#DB2777', '#65A30D',
  '#B45309', '#0F766E', '#6D28D9', '#C2410C',
]
const MUTED_LIGHT = '#E5E7EB'
const MUTED_DARK = '#374151'

const MAX_SLICES = 7

type Row = WrongTypeStat & { rate: number; small: boolean; color: string }

function buildConfig(rows: Row[]): ChartConfig {
  return Object.fromEntries(rows.map((r) => [r.name, { label: r.name, color: r.color }])) as ChartConfig
}

function Tooltip({ active, payload, isDark }: {
  active?: boolean
  payload?: { payload: { name: string; value: number; rate: number; total: number } }[]
  isDark?: boolean
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: isDark ? '#1E293B' : '#FFFFFF',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
      borderRadius: 10, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
    }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#F8FAFC' : '#1A1C1E', marginBottom: 2 }}>{d.name}</p>
      <p style={{ fontSize: 11, color: isDark ? '#94A3B8' : '#8B95A1' }}>
        오답 <span style={{ fontWeight: 700, color: isDark ? '#F8FAFC' : '#1A1C1E' }}>{d.value}/{d.total}문항</span>
        {' · '}{d.rate}%
      </p>
    </div>
  )
}

export function WrongTypeChart({ data, onTagClick, isDark }: {
  data: WrongTypeStat[]
  onTagClick?: (id: string, name: string) => void
  isDark?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const palette = isDark ? COLORS_DARK : COLORS_LIGHT
  const muted = isDark ? MUTED_DARK : MUTED_LIGHT

  const sorted = sortByWeakness(data.filter((d) => d.wrong > 0 && d.total > 0))
  if (sorted.length === 0) return (
    <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-400">오답 데이터가 없습니다</p>
  )

  const rows: Row[] = sorted.map((d, i) => {
    const small = d.total <= SMALL_SAMPLE_MAX
    return {
      ...d,
      rate: Math.round((d.wrong / d.total) * 100),
      small,
      color: small ? muted : palette[i % palette.length],
    }
  })

  const shown = expanded ? rows : rows.slice(0, MAX_SLICES)
  const hasRest = rows.length > MAX_SLICES
  const restWrong = rows.slice(MAX_SLICES).reduce((s, d) => s + d.wrong, 0)

  const pieData = [
    ...shown.map((d) => ({ id: d.id, name: d.name, value: d.wrong, rate: d.rate, total: d.total, color: d.color })),
    ...(!expanded && hasRest
      ? [{ id: '__rest__', name: '기타', value: restWrong, rate: 0, total: 0, color: muted }]
      : []),
  ]

  const click = (id?: string, name?: string) => {
    if (id === '__rest__') { setExpanded(true); return }
    if (id && name && onTagClick) onTagClick(id, name)
  }

  return (
    <div>
      <ChartContainer config={buildConfig(rows)} className="h-[180px] w-full">
        <PieChart>
          <Pie
            data={pieData}
            cx="50%" cy="50%"
            innerRadius={50} outerRadius={76}
            paddingAngle={2.5} dataKey="value"
            strokeWidth={0}
            style={{ cursor: 'pointer' }}
            onClick={(d: { id?: string; name?: string } | null) => d && click(d.id, d.name)}
          >
            {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <ChartTooltip content={<Tooltip isDark={isDark} />} />
        </PieChart>
      </ChartContainer>

      {/* 범례가 오답률을 담당한다 — 조각 크기(횟수)만으로는 "약점" 을 알 수 없어서다 */}
      <div className="mt-3 space-y-2">
        {shown.map((row) => (
          <button
            key={row.id}
            type="button"
            disabled={!onTagClick}
            onClick={() => click(row.id, row.name)}
            className={`w-full text-left ${onTagClick ? 'group' : 'cursor-default'}`}
          >
            <div className="flex items-baseline gap-2">
              <span className="mt-1 h-2 w-2 shrink-0 self-start rounded-full" style={{ backgroundColor: row.color }} />
              <span className={`min-w-0 flex-1 truncate text-xs font-semibold ${
                row.small ? 'text-gray-400 dark:text-gray-500' : 'text-[#1A1C1E] group-hover:underline dark:text-[#F8FAFC]'
              }`}>
                {row.name}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-[#8B95A1] dark:text-[#94A3B8]">
                <span className={`font-bold ${row.small ? 'text-gray-400 dark:text-gray-500' : 'text-rose-500 dark:text-rose-400'}`}>
                  {row.rate}%
                </span>
                <span className="ml-1.5">{row.wrong}/{row.total}문항</span>
              </span>
            </div>
            <div className="mt-1 ml-4 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.08]">
              <div
                className={`h-full rounded-full ${row.small ? 'bg-gray-300 dark:bg-white/20' : 'bg-rose-400 dark:bg-rose-500'}`}
                style={{ width: `${Math.max(row.rate, 2)}%` }}
              />
            </div>
          </button>
        ))}
      </div>

      {shown.some((r) => r.small) && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
          회색은 {SMALL_SAMPLE_MAX}문항 이하로만 출제돼 아직 판단하기 이른 유형입니다.
        </p>
      )}

      {hasRest && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-[#2463EB] hover:underline dark:text-blue-400"
        >
          {expanded ? '접기' : `${rows.length - MAX_SLICES}개 더 보기`}
        </button>
      )}
    </div>
  )
}
