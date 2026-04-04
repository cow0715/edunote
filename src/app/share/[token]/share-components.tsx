'use client'

import { useState, useEffect } from 'react'
import { Moon, Sun, TrendingUp, TrendingDown, Minus, Info, ChevronRight, ChevronLeft } from 'lucide-react'
import { AttendanceRecord } from './share-types'

// ── 공통 카드 ──────────────────────────────────────────────────────────────
export function Card({ title, subtitle, info, infoNode, children, noPad, id }: {
  title?: string; subtitle?: string; info?: string; infoNode?: React.ReactNode
  children: React.ReactNode; noPad?: boolean; id?: string
}) {
  const [infoOpen, setInfoOpen] = useState(false)
  const hasInfo = !!(info || infoNode)

  return (
    <div id={id} className="rounded-3xl bg-white dark:bg-[#1E293B] shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:shadow-none">
      {title && (
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[15px] font-bold text-[#1A1C1E] dark:text-[#F8FAFC]">{title}</h2>
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
              ? <p className="mt-2 text-xs leading-relaxed text-[#2463EB] dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 rounded-xl px-3 py-2">{info}</p>
              : <div className="mt-2">{infoNode}</div>
          )}
        </div>
      )}
      <div className={noPad ? '' : 'px-5 pb-5'}>{children}</div>
    </div>
  )
}

// ── 스탯 카드 ──────────────────────────────────────────────────────────────
export function StatCard({ label, value, delta, color, onClick }: {
  label: string; value: string | null; delta: number | null
  icon?: React.ReactNode; color: 'indigo' | 'emerald' | 'amber' | 'blue'
  onClick?: () => void
}) {
  const accent = {
    indigo:  'text-[#2463EB] dark:text-blue-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber:   'text-amber-500 dark:text-amber-400',
    blue:    'text-[#2463EB] dark:text-blue-400',
  }[color]

  return (
    <div
      className={`relative rounded-2xl bg-white dark:bg-[#1E293B] shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:shadow-none px-3.5 py-4 ${onClick ? 'cursor-pointer active:scale-95 transition-all' : ''}`}
      onClick={onClick}
    >
      <p className={`text-[22px] font-black leading-none ${value ? accent : 'text-[#1A1C1E] dark:text-[#F8FAFC]'}`}>
        {value ?? '-'}
      </p>
      <p className="mt-1.5 text-[11px] text-[#8B95A1] dark:text-[#94A3B8] leading-tight">{label}</p>
      {delta !== null && (
        <div className={`mt-1.5 flex items-center gap-0.5 text-[11px] font-semibold ${
          delta > 0 ? 'text-[#2463EB] dark:text-blue-400' : delta < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-[#8B95A1] dark:text-gray-500'
        }`}>
          {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          <span>{delta > 0 ? '+' : ''}{delta}%</span>
        </div>
      )}
      {onClick && (
        <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-200 dark:text-gray-600" />
      )}
    </div>
  )
}

// ── 출석 캘린더 ────────────────────────────────────────────────────────────
export function AttendanceCalendar({ attendance }: { attendance: AttendanceRecord[] }) {
  const months = [...new Set(attendance.map((a) => a.date.substring(0, 7)))].sort()
  const [idx, setIdx] = useState(months.length - 1)

  useEffect(() => {
    setIdx(months.length - 1)
  }, [months.length])

  if (attendance.length === 0) return (
    <p className="py-6 text-center text-xs text-[#8B95A1] dark:text-gray-500">출결 기록이 없습니다</p>
  )

  const attMap = new Map(attendance.map((a) => [a.date, a.status]))
  const DOW = ['일', '월', '화', '수', '목', '금', '토']
  const STATUS_COLOR: Record<string, string> = {
    present: 'bg-[#2463EB] text-white',
    late:    'bg-amber-400 text-white',
    absent:  'bg-rose-400 text-white',
  }

  const monthStr = months[idx]
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
          onClick={() => setIdx((i) => i - 1)}
          disabled={idx === 0}
          className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-20"
        >
          <ChevronLeft className="h-4 w-4 text-[#1A1C1E] dark:text-gray-300" />
        </button>
        <p className="text-sm font-semibold text-[#1A1C1E] dark:text-gray-300">
          {year}년 {month}월
        </p>
        <button
          onClick={() => setIdx((i) => i + 1)}
          disabled={idx === months.length - 1}
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
        {[['bg-[#2463EB]', '출석'], ['bg-amber-400', '지각'], ['bg-rose-400', '결석']].map(([color, label]) => (
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
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white dark:bg-[#1E293B] shadow-md transition-transform duration-300 ${
            isDark ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      <Moon className="h-3.5 w-3.5 text-gray-400 dark:text-[#3B82F6] transition-colors" />
    </div>
  )
}
