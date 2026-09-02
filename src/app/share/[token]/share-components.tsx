'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Moon, Sun, Info, ChevronRight, ChevronLeft } from 'lucide-react'
import { AttendanceRecord, ClinicAttendanceRecord } from './share-types'
import { CHART_VISIBLE_COUNT, SCROLL_OFFSET_CLASS } from './share-utils'

// ── 공통 표면 ──────────────────────────────────────────────────────────────
// design.md §3: 16px 라운드 + 1px hairline, 그림자 없음. 탭 파일은 이 상수/컴포넌트만 쓴다.
export const SURFACE_CLASS = 'rounded-2xl border border-[#E9EBEF] bg-white dark:border-white/[0.06] dark:bg-[#151B26]'

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${SURFACE_CLASS} px-6 py-10 text-center text-sm text-[#8B95A1]`}>
      {children}
    </div>
  )
}

// ── 공통 카드 ──────────────────────────────────────────────────────────────
export function Card({ title, subtitle, info, infoNode, children, noPad, id }: {
  title?: string; subtitle?: string; info?: string; infoNode?: React.ReactNode
  children: React.ReactNode; noPad?: boolean; id?: string
}) {
  const [infoOpen, setInfoOpen] = useState(false)
  const hasInfo = !!(info || infoNode)

  return (
    <div id={id} className={`${SURFACE_CLASS} ${SCROLL_OFFSET_CLASS}`}>
      {title && (
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[15px] font-bold text-[#1A1C1E] dark:text-[#F1F5F9]">{title}</h2>
            {hasInfo && (
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                className={`rounded-full p-0.5 transition-colors ${infoOpen ? 'text-[#2463EB] dark:text-blue-400' : 'text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-400'}`}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-[#8B95A1] dark:text-[#94A3B8]">{subtitle}</p>}
          {infoOpen && (
            info
              ? <p className="mt-2 rounded-xl bg-[#F5F6F8] px-3 py-2 text-xs leading-relaxed text-[#3F4650] dark:bg-white/[0.04] dark:text-[#CBD5E1]">{info}</p>
              : <div className="mt-2">{infoNode}</div>
          )}
        </div>
      )}
      <div className={noPad ? '' : 'px-5 pb-5'}>{children}</div>
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
    <p className="py-6 text-center text-xs text-[#8B95A1] dark:text-gray-500">출결 기록이 없습니다</p>
  )

  const attMap = new Map(attendance.map((a) => [a.date, a.status]))
  const DOW = ['일', '월', '화', '수', '목', '금', '토']
  const STATUS_COLOR: Record<string, string> = {
    present: 'bg-[#2463EB] text-white',
    late:    'bg-amber-400 text-white',
    absent:  'bg-[#E5484D] text-white dark:bg-[#F87171]',
  }
  const legend = variant === 'clinic'
    ? [['bg-[#2463EB]', '출석'], ['bg-[#E5484D]', '결석']]
    : [['bg-[#2463EB]', '출석'], ['bg-amber-400', '지각'], ['bg-[#E5484D]', '결석']]

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
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setSelectedMonth(months[idx - 1])}
          disabled={idx <= 0}
          className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-20"
        >
          <ChevronLeft className="h-4 w-4 text-[#1A1C1E] dark:text-gray-300" />
        </button>
        <p className="text-sm font-semibold text-[#1A1C1E] dark:text-gray-300">
          {year}년 {month}월
        </p>
        <button
          onClick={() => setSelectedMonth(months[idx + 1])}
          disabled={idx >= months.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-20"
        >
          <ChevronRight className="h-4 w-4 text-[#1A1C1E] dark:text-gray-300" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {DOW.map((d) => (
          <div key={d} className="pb-1 text-[10px] font-medium text-[#8B95A1] dark:text-[#94A3B8]">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />
          const status = attMap.get(toDateStr(d))
          if (!status) return (
            <div key={d} className="flex items-center justify-center py-0.5">
              <span className="text-[11px] text-gray-300 dark:text-gray-500">{d}</span>
            </div>
          )
          return (
            <div key={d} className="flex items-center justify-center py-0.5">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${STATUS_COLOR[status]}`}>
                {d}
              </span>
            </div>
          )
        })}
      </div>

      <div className="flex gap-4 pt-3">
        {legend.map(([color, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${color}`} />
            <span className="text-[11px] text-[#8B95A1] dark:text-gray-300">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 다크모드 토글 ────────────────────────────────────────────────────────────
export function ThemeToggle({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Sun className="h-3.5 w-3.5 text-amber-400 dark:text-[#94A3B8] transition-colors" />
      <button
        role="switch"
        aria-checked={isDark}
        onClick={onToggle}
        className={`relative h-6 w-11 rounded-full transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2463EB] dark:focus-visible:ring-[#3B82F6] ${
          isDark ? 'bg-[#3B82F6]' : 'bg-gray-200'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white dark:bg-[#151B26] shadow-md transition-transform duration-300 ${
            isDark ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      <Moon className="h-3.5 w-3.5 text-gray-400 dark:text-[#3B82F6] transition-colors" />
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
