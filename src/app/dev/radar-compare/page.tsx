'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'

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

export default function RadarComparePage() {
  const [isDark, setIsDark] = useState(false)

  const bg = isDark ? '#0f0f1a' : '#f8fafc'
  const cardBg = isDark ? '#1e1e2e' : '#ffffff'
  const text = isDark ? '#f1f5f9' : '#0f172a'
  const sub = isDark ? '#64748b' : '#94a3b8'

  return (
    <div style={{ background: bg, minHeight: '100vh', padding: '32px 16px', transition: 'all 0.3s' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: text, margin: 0 }}>레이더 차트 비교</h1>
            <p style={{ fontSize: 13, color: sub, margin: '4px 0 0' }}>shadcn/ui Chart · Nivo · ECharts</p>
          </div>
          <button
            onClick={() => setIsDark(!isDark)}
            style={{
              background: isDark ? '#374151' : '#e2e8f0',
              color: text,
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {isDark ? '☀ 라이트' : '☾ 다크'}
          </button>
        </div>

        {/* 카드 3개 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          {[
            { label: '① shadcn/ui Chart', sub: 'Recharts 기반 · 현재 적용됨', Component: ChartShadcn },
            { label: '② Nivo Radar', sub: 'D3 기반 · 부드러운 애니메이션', Component: ChartNivo },
            { label: '③ Apache ECharts', sub: '가장 강력 · SVG 렌더', Component: ChartECharts },
          ].map(({ label, sub: cardSub, Component }) => (
            <div
              key={label}
              style={{
                background: cardBg,
                borderRadius: 16,
                padding: 20,
                boxShadow: isDark
                  ? '0 4px 24px rgba(0,0,0,0.4)'
                  : '0 4px 24px rgba(0,0,0,0.06)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
              }}
            >
              <p style={{ fontSize: 13, fontWeight: 700, color: text, margin: '0 0 2px' }}>{label}</p>
              <p style={{ fontSize: 11, color: sub, margin: '0 0 16px' }}>{cardSub}</p>
              <Component data={SAMPLE_DATA} isDark={isDark} />
            </div>
          ))}
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: sub, marginTop: 32 }}>
          /dev/radar-compare — 개발용 페이지
        </p>
      </div>
    </div>
  )
}
