'use client'

// 레이더 차트 라이브러리 3종 비교 — 개발자 도구(/dev)의 「차트 비교」 탭.
// 다크 토글은 /dev 헤더 것을 쓰므로 isDark 를 prop 으로 받는다.

import dynamic from 'next/dynamic'

const ChartShadcn = dynamic(
  () => import('@/components/share/concept-radar-chart').then((m) => m.ConceptRadarChart),
  { ssr: false }
)
const ChartNivo = dynamic(
  () => import('@/components/share/concept-radar-chart-nivo').then((m) => m.ConceptRadarChartNivo),
  { ssr: false }
)
const ChartECharts = dynamic(
  () => import('@/components/share/concept-radar-chart-echarts').then((m) => m.ConceptRadarChartECharts),
  { ssr: false }
)

const SAMPLE_DATA = [
  { name: '어휘', rate: 82, correct: 9, total: 11 },
  { name: '독해', rate: 65, correct: 13, total: 20 },
  { name: '문법', rate: 50, correct: 5, total: 10 },
  { name: '듣기', rate: 90, correct: 18, total: 20 },
  { name: '작문', rate: 40, correct: 4, total: 10 },
  { name: '회화', rate: 75, correct: 15, total: 20 },
]

const CHARTS = [
  { label: '① shadcn/ui Chart', desc: 'Recharts 기반 · 현재 적용됨', Component: ChartShadcn },
  { label: '② Nivo Radar', desc: 'D3 기반 · 부드러운 애니메이션', Component: ChartNivo },
  { label: '③ Apache ECharts', desc: '가장 강력 · SVG 렌더', Component: ChartECharts },
]

export default function RadarCompare({ isDark }: { isDark: boolean }) {
  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {CHARTS.map(({ label, desc, Component }) => (
        <div key={label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[13px] font-bold text-foreground">{label}</p>
          <p className="mb-4 text-[11px] text-muted-foreground">{desc}</p>
          <Component data={SAMPLE_DATA} isDark={isDark} />
        </div>
      ))}
    </div>
  )
}
