'use client'

// npm install @nivo/radar 필요
import { ResponsiveRadar } from '@nivo/radar'

export type RadarItem = { name: string; rate: number; correct: number; total: number }

export function ConceptRadarChartNivo({ data, isDark }: { data: RadarItem[]; isDark?: boolean }) {
  if (data.length < 3) return (
    <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">
      카테고리가 3개 이상이어야 표시됩니다
    </p>
  )

  // Nivo는 { [key]: value } 형태 데이터 필요
  const nivoData = data.map((d) => ({ 정답률: d.rate, category: d.name }))

  return (
    <div>
      <div style={{ height: 260 }}>
        <ResponsiveRadar
          data={nivoData}
          keys={['정답률']}
          indexBy="category"
          maxValue={100}
          margin={{ top: 16, right: 48, bottom: 16, left: 48 }}
          curve="linearClosed"
          borderWidth={2}
          borderColor={{ from: 'color' }}
          gridLevels={4}
          gridShape="circular"
          gridLabelOffset={12}
          enableDots={true}
          dotSize={8}
          dotColor={{ theme: 'background' }}
          dotBorderWidth={2}
          dotBorderColor={{ from: 'color' }}
          enableDotLabel={false}
          colors={isDark ? ['#818cf8'] : ['#6366f1']}
          fillOpacity={0.22}
          blendMode="normal"
          animate={true}
          motionConfig="gentle"
          isInteractive={true}
          theme={{
            background: 'transparent',
            text: {
              fontSize: 11,
              fill: isDark ? '#94a3b8' : '#64748b',
              fontWeight: 500,
            },
            grid: {
              line: {
                stroke: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                strokeWidth: 1,
              },
            },
            tooltip: {
              container: {
                background: isDark ? '#1e1e2e' : '#ffffff',
                color: isDark ? '#f1f5f9' : '#0f172a',
                fontSize: 12,
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
                backdropFilter: 'blur(8px)',
              },
            },
          }}
          legends={[]}
          sliceTooltip={({ index, data: sliceData }) => {
            const d = sliceData[0]
            const original = data.find((item) => item.name === index)
            return (
              <div
                style={{
                  background: isDark ? '#1e1e2e' : '#fff',
                  border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
                  borderRadius: 10,
                  padding: '8px 12px',
                  fontSize: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                  color: isDark ? '#f1f5f9' : '#0f172a',
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: 4 }}>{index}</p>
                <p style={{ color: isDark ? '#94a3b8' : '#64748b' }}>
                  정답률 <strong style={{ color: isDark ? '#f1f5f9' : '#0f172a' }}>{d.value}%</strong>
                </p>
                {original && (
                  <p style={{ color: isDark ? '#94a3b8' : '#64748b' }}>
                    {original.correct} / {original.total} 문항
                  </p>
                )}
              </div>
            )
          }}
        />
      </div>

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
