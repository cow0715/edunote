'use client'

import { PatternItem, PatternType } from '@/hooks/weakness/useAnalysis'

// ── 패턴 메타 ────────────────────────────────────────────────────────────────
export const PATTERN_META: Record<PatternType, {
  label: string
  color: string
  bgColor: string
  darkBgColor: string
  borderColor: string
  darkBorderColor: string
  insightFn: (p: PatternItem) => string
}> = {
  persistent: {
    label: '고착형',
    color: 'text-rose-500 dark:text-rose-300',
    bgColor: 'bg-rose-50/60',
    darkBgColor: 'dark:bg-rose-950/40',
    borderColor: 'border-rose-200',
    darkBorderColor: 'dark:border-rose-800/50',
    insightFn: (p) =>
      `출제 ${p.weekCount}회 중 ${p.wrongWeekCount}회 오답 — 꾸준히 취약한 유형입니다`,
  },
  deteriorating: {
    label: '악화형',
    color: 'text-orange-500 dark:text-orange-300',
    bgColor: 'bg-orange-50/60',
    darkBgColor: 'dark:bg-orange-950/40',
    borderColor: 'border-orange-200',
    darkBorderColor: 'dark:border-orange-800/50',
    insightFn: (p) =>
      `정답률 ${p.firstAccuracy}% → ${p.latestAccuracy}% (${Math.abs(p.diff)}%p 하락)`,
  },
  intermittent: {
    label: '간헐형',
    color: 'text-violet-500 dark:text-violet-300',
    bgColor: 'bg-violet-50/60',
    darkBgColor: 'dark:bg-violet-950/40',
    borderColor: 'border-violet-200',
    darkBorderColor: 'dark:border-violet-800/50',
    insightFn: (p) =>
      `출제 ${p.weekCount}회 중 ${p.wrongWeekCount}회 오답 — 들쑥날쑥, 완전 습득 필요`,
  },
  improving: {
    label: '개선형',
    color: 'text-emerald-500 dark:text-emerald-300',
    bgColor: 'bg-emerald-50/60',
    darkBgColor: 'dark:bg-emerald-950/40',
    borderColor: 'border-emerald-200',
    darkBorderColor: 'dark:border-emerald-800/50',
    insightFn: (p) =>
      `정답률 ${p.firstAccuracy}% → ${p.latestAccuracy}% (개선 중이나 아직 ${p.latestAccuracy}%)`,
  },
}

// ── 스파크라인 ────────────────────────────────────────────────────────────────
export function Sparkline({ weeks, patternType }: {
  weeks: PatternItem['weeks']
  patternType: PatternType
}) {
  const W = 64, H = 28, PAD = 3
  const lineColor: Record<PatternType, string> = {
    persistent:   '#f43f5e',
    deteriorating:'#f97316',
    intermittent: '#8b5cf6',
    improving:    '#10b981',
  }
  const color = lineColor[patternType]

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
        className="text-gray-300 dark:text-gray-600"
      />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* 마지막 점 */}
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
      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors
        ${meta.bgColor} ${meta.darkBgColor} ${meta.borderColor} ${meta.darkBorderColor}
        hover:brightness-95 dark:hover:brightness-110`}
    >
      {/* 좌: 패턴 뱃지 + 이름 + 인사이트 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${meta.color}
            bg-white/80 dark:bg-white/[0.1]`}>
            {meta.label}
          </span>
          <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {p.name}
          </span>
        </div>
        <p className={`mt-0.5 text-[11px] ${meta.color} opacity-90`}>
          {meta.insightFn(p)}
        </p>
        {/* 주차 칩 */}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {p.weeks.map((w) => (
            <span
              key={w.weekNumber}
              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium
                ${w.accuracy < 50
                  ? `${meta.color} border-current bg-white/60 dark:bg-white/[0.08]`
                  : 'text-gray-400 dark:text-gray-400 border-gray-200 dark:border-gray-600 bg-white/50 dark:bg-white/[0.05]'
                }`}
            >
              {w.weekNumber}주 {w.accuracy}%
            </span>
          ))}
        </div>
      </div>
      {/* 우: 스파크라인 + 전체 정답률 */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Sparkline weeks={p.weeks} patternType={p.patternType} />
        <span className={`text-[11px] font-bold ${meta.color}`}>
          {p.overallAccuracy}% 정답
        </span>
      </div>
    </button>
  )
}
