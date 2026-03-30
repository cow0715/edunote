'use client'

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { statusColor } from '@/lib/chart-colors'

export type RadarItem = { name: string; rate: number; correct: number; total: number }

const chartConfig = {
  rate: {
    label: '정답률',
    color: 'hsl(var(--chart-1))',
  },
} satisfies ChartConfig

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: RadarItem }[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-xl border border-border/40 bg-background/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <p className="mb-1 text-xs font-semibold text-foreground">{d.name}</p>
      <p className="text-xs text-muted-foreground">
        정답률 <span className="font-bold text-foreground">{d.rate}%</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {d.correct} / {d.total} 문항
      </p>
    </div>
  )
}


export function ConceptRadarChart({ data, isDark }: { data: RadarItem[]; isDark?: boolean }) {
  if (data.length < 3) return (
    <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">
      카테고리가 3개 이상이어야 표시됩니다
    </p>
  )

  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const tickColor = isDark ? '#94A3B8' : '#8B95A1'
  const fillColor = isDark ? '#3B82F6' : '#2463EB'

  return (
    <div>
      <ChartContainer config={chartConfig} className="h-[240px] w-full">
        <RadarChart data={data} margin={{ top: 10, right: 24, bottom: 10, left: 24 }}>
          <defs>
            <radialGradient id="radarGradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={fillColor} stopOpacity={0.45} />
              <stop offset="100%" stopColor={fillColor} stopOpacity={0.05} />
            </radialGradient>
          </defs>
          <PolarGrid
            stroke={gridColor}
            strokeWidth={1}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <PolarAngleAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: tickColor, fontWeight: 500 }}
          />
          <ChartTooltip content={<CustomTooltip />} />
          <Radar
            name="정답률"
            dataKey="rate"
            stroke={fillColor}
            strokeWidth={2}
            fill="url(#radarGradient)"
            dot={{ r: 4, fill: fillColor, strokeWidth: 2, stroke: isDark ? '#1E293B' : '#FFFFFF' }}
            activeDot={{ r: 6, fill: fillColor, strokeWidth: 2, stroke: isDark ? '#1E293B' : '#FFFFFF' }}
          />
        </RadarChart>
      </ChartContainer>

      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: statusColor(d.rate, isDark) }}
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
