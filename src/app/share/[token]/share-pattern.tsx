'use client'

// 약점 패턴 카드.
//
// design_handoff_share_report/README.md "3. 분석 > 약점 패턴".
// 패턴 종류마다 색을 배정하지 않는다 — 의미만 남긴다:
//   고착·악화 = 빨강(주의) / 기복 = 회색 / 개선 = 파랑.

import { PatternItem, PatternType } from '@/hooks/weakness/useAnalysis'
import { PRESS, T } from './share-tokens'

export const PATTERN_META: Record<PatternType, {
  label: string
  /** 배지 배경 · 누적 정답률 숫자 색 */
  accent: string
  insightFn: (p: PatternItem) => string
}> = {
  persistent: {
    label: '고착',
    accent: T.red,
    insightFn: (p) => `${p.weekCount}회 출제 중 ${p.wrongWeekCount}회 오답 · 평균 ${p.overallAccuracy}%`,
  },
  deteriorating: {
    label: '악화',
    accent: T.red,
    insightFn: (p) => `최근 정답률 ${p.recentAccuracy}% · ${Math.abs(p.trend)}%p 하락 추세`,
  },
  improving: {
    label: '개선',
    accent: T.blue,
    insightFn: (p) => `${p.trend}%p 상승 중 · 현재 ${p.recentAccuracy}%`,
  },
  unstable: {
    label: '기복',
    accent: T.muted,
    insightFn: (p) => {
      const accuracies = p.weeks.map((w) => w.accuracy)
      return `정답률 ${Math.min(...accuracies)}%~${Math.max(...accuracies)}% 변동 · 평균 ${p.overallAccuracy}%`
    },
  },
}

/**
 * 주차별 미니 바.
 *
 * 출제되지 않은 주차도 3px 자리로 남긴다 — 빈 자리가 있어야 "매주 나오는 유형인가,
 * 가끔 나오는 유형인가" 가 보인다. 막대만 이어 붙이면 둘이 똑같아 보인다.
 */
function MiniBars({ weeks, accent, allWeekNumbers }: {
  weeks: PatternItem['weeks']
  accent: string
  allWeekNumbers: number[]
}) {
  const byWeek = new Map(weeks.map((w) => [w.weekNumber, w.accuracy]))
  const slots = allWeekNumbers.length > 0 ? allWeekNumbers : weeks.map((w) => w.weekNumber)

  return (
    <div className="flex h-10 items-end gap-1">
      {slots.map((weekNumber) => {
        const accuracy = byWeek.get(weekNumber)
        if (accuracy === undefined) {
          return <span key={weekNumber} className="h-[3px] flex-1 rounded-full bg-[#F2F4F6]" />
        }
        return (
          <span
            key={weekNumber}
            className="flex-1 rounded-[2px]"
            style={{
              height: `${Math.max(6, (accuracy / 100) * 40)}px`,
              background: accent,
              // 60% 미만은 흐리게 — 색을 하나 더 쓰지 않고 강약만 준다
              opacity: accuracy >= 60 ? 1 : 0.55,
            }}
          />
        )
      })}
    </div>
  )
}

export function PatternCard({ pattern: p, allWeekNumbers = [], onTagClick }: {
  pattern: PatternItem
  /** 이 기간의 전체 회차 번호 — 미출제 자리를 그리는 데 쓴다 */
  allWeekNumbers?: number[]
  onTagClick: (id: string, name: string) => void
}) {
  const meta = PATTERN_META[p.patternType]
  return (
    <button
      type="button"
      onClick={() => onTagClick(p.id, p.name)}
      className={`${PRESS} w-full rounded-[18px] bg-white px-4 py-3.5 text-left`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span
            className="inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white"
            style={{ background: meta.accent }}
          >
            {meta.label}
          </span>
          <p className="mt-1.5 truncate text-[16px] font-extrabold">{p.name}</p>
          <p className="mt-0.5 text-[12px] text-[#8B95A1] tabular-nums">{meta.insightFn(p)}</p>
        </div>
        <span className="shrink-0 text-[26px] font-black tabular-nums" style={{ color: meta.accent }}>
          {p.overallAccuracy}
          <span className="text-[13px]">%</span>
        </span>
      </div>
      <div className="mt-3">
        <MiniBars weeks={p.weeks} accent={meta.accent} allWeekNumbers={allWeekNumbers} />
      </div>
    </button>
  )
}
