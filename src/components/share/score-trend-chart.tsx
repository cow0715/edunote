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

export function ScoreTrendChart({ data }: { data: TrendItem[] }) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value, name) => {
              const s = SERIES.find((s) => s.key === name || s.classKey === name)
              const isClass = SERIES.some((s) => s.classKey === name)
              return [value !== null ? `${value}%` : '-', isClass ? `반평균 ${s?.label}` : s?.label ?? String(name)]
            }}
            labelStyle={{ fontSize: 12 }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          {SERIES.flatMap((s) => [
            <Line
              key={s.classKey}
              type="monotone"
              dataKey={s.classKey}
              stroke={s.classColor}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
            />,
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2.5}
              dot={{ r: 4, fill: s.color }}
              activeDot={{ r: 6 }}
              connectNulls
            />,
          ])}
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap justify-center gap-4">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-gray-600">{s.label}</span>
            </div>
            <div className="flex items-center gap-1">
              <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke={s.classColor} strokeWidth="1.5" strokeDasharray="4 3" /></svg>
              <span className="text-xs text-gray-400">반평균</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
