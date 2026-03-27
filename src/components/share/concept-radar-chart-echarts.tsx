'use client'

// npm install echarts echarts-for-react 필요
import ReactECharts from 'echarts-for-react'

export type RadarItem = { name: string; rate: number; correct: number; total: number }

export function ConceptRadarChartECharts({ data, isDark }: { data: RadarItem[]; isDark?: boolean }) {
  if (data.length < 3) return (
    <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">
      카테고리가 3개 이상이어야 표시됩니다
    </p>
  )

  const textColor = isDark ? '#94a3b8' : '#64748b'
  const lineColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const mainColor = isDark ? '#818cf8' : '#6366f1'

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: isDark ? '#1e1e2e' : '#ffffff',
      borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: {
        color: isDark ? '#f1f5f9' : '#0f172a',
        fontSize: 12,
      },
      extraCssText: 'border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); backdrop-filter: blur(8px);',
      formatter: (params: { name: string; value: number[] }) => {
        const lines = data.map((d, i) => {
          const val = params.value[i]
          const color = val >= 80 ? '#22c55e' : val >= 60 ? '#f59e0b' : '#f87171'
          return `<div style="display:flex;justify-content:space-between;gap:12px;margin:2px 0">
            <span style="color:${textColor}">${d.name}</span>
            <span style="font-weight:600;color:${color}">${val}%</span>
          </div>`
        })
        return `<div style="min-width:120px"><div style="font-weight:600;margin-bottom:6px;color:${isDark ? '#f1f5f9' : '#0f172a'}">정답률</div>${lines.join('')}</div>`
      },
    },
    radar: {
      indicator: data.map((d) => ({ name: d.name, max: 100 })),
      shape: 'circle',
      splitNumber: 4,
      axisName: {
        color: textColor,
        fontSize: 11,
        fontWeight: 500,
      },
      splitLine: {
        lineStyle: {
          color: Array(4).fill(lineColor),
          width: 1,
        },
      },
      splitArea: {
        areaStyle: {
          color: Array(4).fill('transparent'),
        },
      },
      axisLine: {
        lineStyle: {
          color: lineColor,
        },
      },
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: data.map((d) => d.rate),
            name: '정답률',
            areaStyle: {
              color: {
                type: 'radial',
                x: 0.5, y: 0.5, r: 0.5,
                colorStops: [
                  { offset: 0, color: mainColor + 'aa' },
                  { offset: 1, color: mainColor + '18' },
                ],
              },
            },
            lineStyle: {
              color: mainColor,
              width: 2,
            },
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: {
              color: mainColor,
              borderColor: isDark ? '#1e1e2e' : '#ffffff',
              borderWidth: 2,
            },
          },
        ],
        animation: true,
        animationDuration: 600,
        animationEasing: 'cubicOut',
      },
    ],
  }

  return (
    <div>
      <ReactECharts
        option={option}
        style={{ height: 260, width: '100%' }}
        opts={{ renderer: 'svg' }}
      />

      <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: d.rate >= 80 ? '#22c55e' : d.rate >= 60 ? '#f59e0b' : '#f87171',
              }}
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
