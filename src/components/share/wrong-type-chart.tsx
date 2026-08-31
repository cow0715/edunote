'use client'

// 유형별 오답률 막대.
//
// 예전에는 도넛 차트로 "오답이 어디에 몰렸나(구성비)" 를 보여줬는데,
// 많이 출제된 유형이 무조건 커 보여서 "약점" 으로 오해됐다 (내용 일치 15회 = 3문항).
// 지금은 "그 유형을 얼마나 틀리나" 를 직접 그린다.
//
// 정렬은 오답률이 아니라 Wilson 하한(wrongRateScore)으로 한다 — 이유는 lib/wrong-rate.ts 참고.
// 막대 길이는 실제 오답률이라 화면에 보이는 값과 정렬 근거가 다르다. 그래서 표본(n/m문항)을
// 항상 같이 적어 판단 근거를 숨기지 않는다.

import { useState } from 'react'
import { SMALL_SAMPLE_MAX, sortByWeakness, type WrongTypeStat } from '@/lib/wrong-rate'

const MAX_ROWS = 7

export function WrongTypeChart({ data, onTagClick }: {
  data: WrongTypeStat[]
  onTagClick?: (id: string, name: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const rows = sortByWeakness(data.filter((d) => d.wrong > 0 && d.total > 0))
  if (rows.length === 0) return (
    <p className="py-8 text-center text-xs text-gray-400 dark:text-gray-400">오답 데이터가 없습니다</p>
  )

  const shown = expanded ? rows : rows.slice(0, MAX_ROWS)
  const hasRest = rows.length > MAX_ROWS

  return (
    <div>
      <div className="space-y-2.5">
        {shown.map((row) => {
          const rate = Math.round((row.wrong / row.total) * 100)
          const small = row.total <= SMALL_SAMPLE_MAX
          const clickable = !!onTagClick
          return (
            <button
              key={row.id}
              type="button"
              disabled={!clickable}
              onClick={() => onTagClick?.(row.id, row.name)}
              className={`w-full text-left ${clickable ? 'group' : 'cursor-default'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-xs font-semibold ${
                  small
                    ? 'text-gray-400 dark:text-gray-500'
                    : 'text-[#1A1C1E] group-hover:underline dark:text-[#F8FAFC]'
                }`}>
                  {row.name}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-[#8B95A1] dark:text-[#94A3B8]">
                  <span className={`font-bold ${small ? 'text-gray-400 dark:text-gray-500' : 'text-rose-500 dark:text-rose-400'}`}>
                    {rate}%
                  </span>
                  <span className="ml-1.5">{row.wrong}/{row.total}문항</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.08]">
                <div
                  className={`h-full rounded-full ${small ? 'bg-gray-300 dark:bg-white/20' : 'bg-rose-400 dark:bg-rose-500'}`}
                  style={{ width: `${Math.max(rate, 2)}%` }}
                />
              </div>
            </button>
          )
        })}
      </div>

      {shown.some((r) => r.total <= SMALL_SAMPLE_MAX) && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
          회색은 {SMALL_SAMPLE_MAX}문항 이하로만 출제돼 아직 판단하기 이른 유형입니다.
        </p>
      )}

      {hasRest && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-[#2463EB] hover:underline dark:text-blue-400"
        >
          {expanded ? '접기' : `${rows.length - MAX_ROWS}개 더 보기`}
        </button>
      )}
    </div>
  )
}
