'use client'

import { PatternItem, PatternType } from '@/hooks/weakness/useAnalysis'

// ── 패턴 메타 ────────────────────────────────────────────────────────────────
export const PATTERN_META: Record<PatternType, {
  label: string
  color: string    // Tailwind 텍스트 색상
  accent: string   // hex — 스트라이프·스파크라인용
  insightFn: (p: PatternItem) => string
}> = {
  persistent: {
    label: '고착',
    color: 'text-rose-500 dark:text-rose-400',
    accent: '#f43f5e',
    insightFn: (p) =>
      `출제 ${p.weekCount}회 중 ${p.wrongWeekCount}회 오답 · 평균 정답률 ${p.overallAccuracy}%`,
  },
  deteriorating: {
    label: '악화',
    color: 'text-orange-500 dark:text-orange-400',
    accent: '#f97316',
    insightFn: (p) =>
      `정답률 ${p.firstAccuracy}% → ${p.latestAccuracy}% (${Math.abs(p.diff)}%p 하락)`,
  },
  improving: {
    label: '개선',
    color: 'text-emerald-500 dark:text-emerald-400',
    accent: '#10b981',
    insightFn: (p) =>
      `정답률 ${p.firstAccuracy}% → ${p.latestAccuracy}% (+${p.diff}%p)`,
  },
}

// ── 스파크라인 ────────────────────────────────────────────────────────────────
export function Sparkline({ weeks, patternType }: {
  weeks: PatternItem['weeks']
  patternType: PatternType
}) {
  const W = 64, H = 28, PAD = 3
  const color = PATTERN_META[patternType].accent

  if (weeks.length < 2) return null

  const xs = weeks.map((_, i) => PAD + (i / (weeks.length - 1)) * (W - PAD * 2))
  const ys = weeks.map((w) => H - PAD - (w.accuracy / 100) * (H - PAD * 2))

  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')

  return (
    <svg width={W} height={H} className="shrink-0">
      {/* 기준선 50% */}
      <line
        x1={PAD} y1={(H / 2).toFixed(1)} x2={W - PAD} y2={(H / 2).toFixed(1)}
        stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2"
        className="text-gray-200 dark:text-gray-700"
      />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1].toFixed(1)} cy={ys[ys.length - 1].toFixed(1)} r="2.5" fill={color} />
    </svg>
  )
}

// ── 패턴 카드 ─────────────────────────────────────────────────────────────────
export function PatternCard({ pattern: p, onTagClick }: {
  pattern: PatternItem
  onTagClick: (id: string, name: string) => void
}) {
  const meta = PATTERN_META[p.patternType]
  return (
    <button
      type="button"
      onClick={() => onTagClick(p.id, p.name)}
      className="flex w-full items-stretch overflow-hidden rounded-2xl border border-gray-100/80 dark:border-white/[0.06] bg-white dark:bg-[#1C1C1E] text-left shadow-[0_10px_40px_rgba(0,75,198,0.03)] transition-all hover:shadow-[0_10px_40px_rgba(0,75,198,0.06)] active:scale-95"
    >
      {/* 좌측 컬러 스트라이프 */}
      <span className="w-[3px] shrink-0 self-stretch" style={{ backgroundColor: meta.accent }} />

      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        {/* 좌: 유형 + 이름 + 인사이트 + 주차 칩 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 text-[10px] font-bold ${meta.color}`}>{meta.label}</span>
            <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{p.name}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            {meta.insightFn(p)}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {p.weeks.map((w) => (
              <span
                key={w.weekNumber}
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  w.accuracy < 50
                    ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-600 dark:text-gray-300'
                    : 'bg-gray-50 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500'
                }`}
              >
                {w.weekNumber}주 {w.accuracy}%
              </span>
            ))}
          </div>
        </div>

        {/* 우: 스파크라인 + 정답률 */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Sparkline weeks={p.weeks} patternType={p.patternType} />
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            {p.overallAccuracy}%
          </span>
        </div>
      </div>
    </button>
  )
}
