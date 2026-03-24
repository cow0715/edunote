'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export type TrendItem = {
  label: string
  readingRate: number | null
  vocabRate: number | null
  classReadingRate: number | null
  classVocabRate: number | null
}

const SERIES = [
  { key: 'readingRate', classKey: 'classReadingRate', label: '시험', color: '#6366f1', classColor: '#c7d2fe' },
  { key: 'vocabRate',   classKey: 'classVocabRate',   label: '단어', color: '#22c55e', classColor: '#bbf7d0' },
] as const

// 다크모드 라인 색상 — 배경이 어두우므로 400 계열 (밝게)
const DARK_COLORS = ['#818cf8', '#4ade80'] as const

export function ScoreTrendChart({ data, isDark }: { data: TrendItem[]; isDark?: boolean }) {
  const grid     = isDark ? 'rgba(255,255,255,0.1)'  : '#f0f0f0'
  const tick     = isDark ? '#d1d5db'                : '#9ca3af'   // 다크: gray-300 (라이트 반전)
  const ttBg     = isDark ? '#1c1c2a'                : '#ffffff'
  const ttBorder = isDark ? '#374151'                : '#e5e7eb'
  const ttColor  = isDark ? '#f3f4f6'                : '#111827'

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: tick }} unit="%" axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value, name) => {
              const s = SERIES.find((s) => s.key === name || s.classKey === name)
              const isClass = SERIES.some((s) => s.classKey === name)
              return [value !== null ? `${value}%` : '-', isClass ? `반평균 ${s?.label}` : s?.label ?? String(name)]
            }}
            labelStyle={{ fontSize: 12, color: ttColor }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${ttBorder}`, backgroundColor: ttBg, color: ttColor }}
          />
          {SERIES.flatMap((s, i) => {
            const solidColor = isDark ? DARK_COLORS[i] : s.color
            const dashColor  = isDark ? `${DARK_COLORS[i]}55` : s.classColor
            return [
              <Line key={s.classKey} type="monotone" dataKey={s.classKey}
                stroke={dashColor} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />,
              <Line key={s.key} type="monotone" dataKey={s.key}
                stroke={solidColor} strokeWidth={2.5} dot={{ r: 4, fill: solidColor }} activeDot={{ r: 6 }} connectNulls />,
            ]
          })}
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap justify-center gap-4">
        {SERIES.map((s, i) => {
          const solidColor = isDark ? DARK_COLORS[i] : s.color
          const dashColor  = isDark ? `${DARK_COLORS[i]}55` : s.classColor
          return (
            <div key={s.key} className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: solidColor }} />
                <span className="text-xs text-gray-600 dark:text-gray-300">{s.label}</span>
              </div>
              <div className="flex items-center gap-1">
                <svg width="16" height="8">
                  <line x1="0" y1="4" x2="16" y2="4" stroke={dashColor} strokeWidth="1.5" strokeDasharray="4 3" />
                </svg>
                <span className="text-xs text-gray-400 dark:text-gray-400">반평균</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
