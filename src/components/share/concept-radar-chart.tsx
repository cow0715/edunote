'use client'

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts'

export type RadarItem = { name: string; rate: number; correct: number; total: number }

export function ConceptRadarChart({ data, isDark }: { data: RadarItem[]; isDark?: boolean }) {
  const gridColor   = isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb'
  const tickColor   = isDark ? '#d1d5db' : '#6b7280'
  const radarColor  = isDark ? '#818cf8' : '#6366f1'
  const ttBg        = isDark ? '#1c1c2a' : '#ffffff'
  const ttBorder    = isDark ? '#374151' : '#e5e7eb'
  const ttColor     = isDark ? '#f3f4f6' : '#111827'

  if (data.length < 3) return (
    <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">
      카테고리가 3개 이상이어야 표시됩니다
    </p>
  )

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <RadarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
          <PolarGrid stroke={gridColor} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <PolarAngleAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: tickColor }}
          />
          <Tooltip
            formatter={(value, _, props) => [
              `${value}% (${props.payload?.correct}/${props.payload?.total})`,
              '정답률',
            ]}
            labelStyle={{ fontSize: 12, color: ttColor }}
            itemStyle={{ color: ttColor }}
            contentStyle={{
              fontSize: 12, borderRadius: 8,
              border: `1px solid ${ttBorder}`,
              backgroundColor: ttBg, color: ttColor,
            }}
          />
          <Radar
            name="정답률"
            dataKey="rate"
            stroke={radarColor}
            fill={radarColor}
            fillOpacity={0.25}
            dot={{ r: 3, fill: radarColor }}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* 범례 */}
      <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: d.rate >= 80 ? '#22c55e' : d.rate >= 60 ? '#f59e0b' : '#f87171' }}
            />
            <span className="text-[11px] text-gray-600 dark:text-gray-300">
              {d.name} <span className="font-semibold">{d.rate}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
