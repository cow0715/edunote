'use client'

import { useId } from 'react'
import { ArrowRight } from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { AnalysisType } from '@/lib/share-analysis'
import { PRESS_ROW, T } from './share-tokens'

const MAX_COMPARISON_TYPES = 3
const INITIAL_CHART_SIZE = { width: 280, height: 10 }

/** Fixed-scale comparison; the readable HTML carries the same values and actions. */
export function AnalysisPriorityChart({ types, onTagClick }: {
  types: AnalysisType[]
  onTagClick: (id: string, name: string) => void
}) {
  const comparisonId = useId()
  const visibleTypes = types.slice(0, MAX_COMPARISON_TYPES)
  if (visibleTypes.length === 0) return null

  return (
    <ul className="min-w-0" aria-label="먼저 확인할 유형의 기간 오답률 비교">
      {visibleTypes.map((type, index) => {
        const { cumulative } = type
        const wrongRate = cumulative.total > 0 ? cumulative.wrong / cumulative.total * 100 : 0
        const displayWrongRate = Math.round(wrongRate)
        const insufficient = type.status === 'insufficient'
        const recentConcern = type.status === 'stable' && type.recentStatus === 'priority'
        const recovered = (type.status === 'priority' || type.status === 'review') && type.recentStatus === 'stable'
        const color = type.status === 'priority' ? T.red : insufficient ? T.muted : T.body2
        const evidence = `${cumulative.total}문항 중 오답 ${cumulative.wrong}`
        const supporting = insufficient ? '판정 보류'
          : recentConcern ? `최근 ${type.recentCount}회 정답률 ${type.recent.rate}% · 최근 결과 확인`
          : recovered ? `최근 ${type.recentCount}회는 ${type.recent.rate}% · 이전 오답 확인`
          : type.wrongAppearances >= 2 ? `${type.wrongAppearances}회에서 오답 반복` : null
        const rateId = `${comparisonId}-${index}-rate`
        const evidenceId = `${comparisonId}-${index}-evidence`
        const reasonId = `${comparisonId}-${index}-reason`
        const content = (
          <>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0 break-words text-[14px] font-extrabold leading-[1.45] [overflow-wrap:anywhere]" style={{ color: T.ink }}>
                {type.name}
              </span>
              <span id={rateId} className="shrink-0 text-[18px] font-extrabold leading-[1.2] tabular-nums" style={{ color }}>
                <span className="sr-only">기간 오답률 </span>{displayWrongRate}%
              </span>
            </div>

            <div className="my-2 min-w-0 overflow-hidden rounded-full" aria-hidden="true">
              <ResponsiveContainer width="100%" height={10} minWidth={0} initialDimension={INITIAL_CHART_SIZE}>
                <BarChart
                  data={[{ rate: wrongRate }]}
                  layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  accessibilityLayer={false} tabIndex={-1}
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis type="category" hide />
                  <Bar dataKey="rate" fill={color} barSize={10} radius={5} background={{ fill: T.lineStrong, radius: 5 }} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] leading-[1.5]">
              <span id={evidenceId} className="tabular-nums" style={{ color: T.muted }}>{evidence}</span>
              {cumulative.wrong > 0 && <span className="flex shrink-0 items-center gap-1 font-semibold" style={{ color: T.body2 }}>오답 {cumulative.wrong}문항 보기 <ArrowRight size={12} aria-hidden="true" /></span>}
            </div>
            {supporting && <p id={reasonId} className="mt-1 text-[11px] leading-[1.5]" style={{ color: recentConcern ? T.red : T.muted }}>{supporting}</p>}
          </>
        )
        const rowClass = `${index > 0 ? 'border-t ' : ''}py-3`
        return (
          <li key={type.id} className={rowClass} style={{ borderColor: T.line }}>
            {cumulative.wrong > 0 ? (
              <button
                type="button"
                className={`${PRESS_ROW} block w-full min-w-0 rounded-[12px] text-left`}
                aria-label={`${type.name} 오답 ${cumulative.wrong}문항 보기`}
                aria-describedby={[rateId, evidenceId, supporting ? reasonId : null].filter(Boolean).join(' ')}
                onClick={() => onTagClick(type.id, type.name)}
              >
                {content}
              </button>
            ) : <div>{content}</div>}
          </li>
        )
      })}
    </ul>
  )
}
