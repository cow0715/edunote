'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export type TrendItem = {
  label: string
  readingRate: number | null
  vocabRate: number | null
}

export function ScoreTrendChart({ data }: { data: TrendItem[] }) {
  const hasReading = data.some((d) => d.readingRate !== null)
  const hasVocab = data.some((d) => d.vocabRate !== null)

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
        <Tooltip
          formatter={(value, name) => [
            value !== null ? `${value}%` : '-',
            name === 'readingRate' ? '독해' : '단어',
          ]}
          labelStyle={{ fontSize: 12 }}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        {(hasReading || hasVocab) && (
          <Legend
            formatter={(value) => (value === 'readingRate' ? '독해' : '단어')}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12 }}
          />
        )}
        {hasReading && (
          <Line
            type="monotone"
            dataKey="readingRate"
            stroke="#6366f1"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#6366f1' }}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
        )}
        {hasVocab && (
          <Line
            type="monotone"
            dataKey="vocabRate"
            stroke="#22c55e"
            strokeWidth={2.5}
            dot={{ r: 4, fill: '#22c55e' }}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
