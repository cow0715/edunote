'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { AttendanceRecord, ClinicAttendanceRecord } from './share-types'
import { CHART_VISIBLE_COUNT } from './share-utils'
import { ATT_DOT, CARD_CLASS, PRESS, T, riseStyle } from './share-tokens'

// ── 공통 표면 ──────────────────────────────────────────────────────────────
// 카드는 배경색 차이로만 구분한다. 테두리·그림자 없음, 라운드 20px.
export const SURFACE_CLASS = CARD_CLASS

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className={`${SURFACE_CLASS} px-6 py-10 text-center text-[13px] text-[#8B95A1]`}>
      {children}
    </div>
  )
}

/** 카드 안 "데이터 없음" 안내 — 제목 + 한 줄 설명 */
export function EmptyNote({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={`${SURFACE_CLASS} px-6 py-9 text-center`}>
      <p className="text-[14px] font-bold text-[#191F28]">{title}</p>
      {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-[#8B95A1]">{hint}</p>}
    </div>
  )
}

// ── 공통 카드 ──────────────────────────────────────────────────────────────
export function Card({ title, subtitle, aside, children, noPad, id, riseIndex }: {
  title?: string
  subtitle?: string
  /** 타이틀 오른쪽 보조 정보 (11px 회색) */
  aside?: ReactNode
  children: ReactNode
  noPad?: boolean
  id?: string
  riseIndex?: number
}) {
  return (
    <div id={id} className={`${SURFACE_CLASS} scroll-mt-4`} style={riseIndex === undefined ? undefined : riseStyle(riseIndex)}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-[22px] pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-extrabold tracking-[-0.01em] text-[#191F28]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-[#8B95A1]">{subtitle}</p>}
          </div>
          {aside && <span className="shrink-0 text-[11px] text-[#8B95A1]">{aside}</span>}
        </div>
      )}
      <div className={noPad ? '' : `px-[22px] pb-5 ${title ? '' : 'pt-5'}`}>{children}</div>
    </div>
  )
}

// ── 출석 캘린더 ────────────────────────────────────────────────────────────
type AttendanceCalendarRecord = AttendanceRecord | ClinicAttendanceRecord

export function AttendanceCalendar({
  attendance,
  variant = 'regular',
}: {
  attendance: AttendanceCalendarRecord[]
  variant?: 'regular' | 'clinic'
}) {
  const months = [...new Set(attendance.map((a) => a.date.substring(0, 7)))].sort()
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)

  if (attendance.length === 0) return (
    <p className="py-6 text-center text-[12px] text-[#8B95A1]">출결 기록이 없어요</p>
  )

  const attMap = new Map(attendance.map((a) => [a.date, a.status]))
  const DOW = ['일', '월', '화', '수', '목', '금', '토']
  const legend: [string, string][] = variant === 'clinic'
    ? [[T.blue, '출석'], [T.red, '결석']]
    : [[T.blue, '출석'], [T.muted, '지각'], [T.red, '결석']]

  // selectedMonth가 null이거나 목록에 없으면 가장 최신 월
  const monthStr = (selectedMonth && months.includes(selectedMonth)) ? selectedMonth : months[months.length - 1]
  const idx = months.indexOf(monthStr)
  const [year, month] = monthStr.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDow = new Date(year, month - 1, 1).getDay()

  const cells: (number | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const toDateStr = (d: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  return (
    <div>
      {/* 월 네비게이션 — 스코프 밖 월은 눌러도 갈 곳이 없어 흐리게 둔다 */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="이전 달"
          onClick={() => setSelectedMonth(months[idx - 1])}
          disabled={idx <= 0}
          className={`${PRESS} flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-30`}
        >
          <ChevronLeft className="h-4 w-4 text-[#4E5968]" />
        </button>
        <p className="text-[13px] font-extrabold text-[#191F28]">{year}년 {month}월</p>
        <button
          type="button"
          aria-label="다음 달"
          onClick={() => setSelectedMonth(months[idx + 1])}
          disabled={idx >= months.length - 1}
          className={`${PRESS} flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-30`}
        >
          <ChevronRight className="h-4 w-4 text-[#4E5968]" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {DOW.map((d) => (
          <div key={d} className="pb-1 text-[10px] font-bold text-[#8B95A1]">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />
          const status = attMap.get(toDateStr(d))
          return (
            <div key={d} className="flex items-center justify-center py-0.5">
              {status ? (
                <span
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-bold tabular-nums text-white"
                  style={{ background: ATT_DOT[status] }}
                >
                  {d}
                </span>
              ) : (
                <span className="text-[11px] tabular-nums text-[#B0B8C1]">{d}</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-4 pt-3">
        {legend.map(([color, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            <span className="text-[11px] text-[#8B95A1]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 가로 스와이프 차트 카드 ─────────────────────────────────────────────────
export function SwipeChartCard({
  id,
  title,
  subtitle,
  itemCount,
  children,
  scrollBody = true,
}: {
  id?: string
  title: string
  subtitle: string
  itemCount: number
  children: ReactNode
  scrollBody?: boolean
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const width = itemCount > CHART_VISIBLE_COUNT ? `${(itemCount / CHART_VISIBLE_COUNT) * 100}%` : '100%'

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !scrollBody) return
    const frame = window.requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth - el.clientWidth
    })
    return () => window.cancelAnimationFrame(frame)
  }, [itemCount, scrollBody])

  return (
    <Card id={id} title={title} subtitle={subtitle}>
      {scrollBody ? (
        <div
          ref={scrollerRef}
          className="-mx-1 overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div style={{ width, minWidth: '100%' }}>
            {children}
          </div>
        </div>
      ) : children}
    </Card>
  )
}
