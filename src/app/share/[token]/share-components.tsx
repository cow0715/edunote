'use client'

import { useState } from 'react'
import { Moon, Sun, TrendingUp, TrendingDown, Minus, Info, ChevronRight } from 'lucide-react'
import { AttendanceRecord } from './share-types'

// ── 공통 카드 ──────────────────────────────────────────────────────────────
export function Card({ title, subtitle, info, infoNode, children, noPad, id }: {
  title?: string; subtitle?: string; info?: string; infoNode?: React.ReactNode
  children: React.ReactNode; noPad?: boolean; id?: string
}) {
  const [infoOpen, setInfoOpen] = useState(false)
  const hasInfo = !!(info || infoNode)

  return (
    <div id={id} className="rounded-2xl bg-white dark:bg-card shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10">
      {title && (
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2>
            {hasInfo && (
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                className={`rounded-full p-0.5 transition-colors ${infoOpen ? 'text-indigo-500 dark:text-indigo-400' : 'text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-400'}`}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-300">{subtitle}</p>}
          {infoOpen && (
            info
              ? <p className="mt-2 text-xs leading-relaxed text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg px-3 py-2">{info}</p>
              : <div className="mt-2">{infoNode}</div>
          )}
        </div>
      )}
      <div className={noPad ? '' : 'px-5 pb-5'}>{children}</div>
    </div>
  )
}

// ── 스탯 카드 ──────────────────────────────────────────────────────────────
export function StatCard({ label, value, delta, icon, color, onClick }: {
  label: string; value: string | null; delta: number | null
  icon: React.ReactNode; color: 'indigo' | 'emerald' | 'amber' | 'blue'
  onClick?: () => void
}) {
  const c = {
    indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-900/40',   icon: 'text-indigo-500 dark:text-indigo-300',   val: 'text-indigo-700 dark:text-indigo-200'   },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/40', icon: 'text-emerald-500 dark:text-emerald-300', val: 'text-emerald-700 dark:text-emerald-200' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-900/40',     icon: 'text-amber-500 dark:text-amber-300',     val: 'text-amber-700 dark:text-amber-200'     },
    blue:    { bg: 'bg-blue-50 dark:bg-blue-900/40',       icon: 'text-blue-500 dark:text-blue-300',       val: 'text-blue-700 dark:text-blue-200'       },
  }[color]

  return (
    <div
      className={`relative rounded-2xl bg-white dark:bg-card shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10 px-3 py-3 ${onClick ? 'cursor-pointer active:scale-[0.97] transition-all hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-500/60 hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg ${c.bg}`}>
        <span className={`${c.icon} [&>svg]:h-3.5 [&>svg]:w-3.5`}>{icon}</span>
      </div>
      <p className={`text-lg font-bold leading-tight ${c.val}`}>{value ?? '-'}</p>
      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{label}</p>
      {delta !== null && (
        <div className={`mt-1.5 flex items-center gap-0.5 text-[10px] font-medium ${
          delta > 0 ? 'text-emerald-500 dark:text-emerald-400' : delta < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-gray-400 dark:text-gray-400'
        }`}>
          {delta > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : delta < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
          <span>{delta > 0 ? '+' : ''}{delta}%</span>
        </div>
      )}
      {onClick && (
        <ChevronRight className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-300 dark:text-gray-600" />
      )}
    </div>
  )
}

// ── 출석 캘린더 ────────────────────────────────────────────────────────────
export function AttendanceCalendar({ attendance }: { attendance: AttendanceRecord[] }) {
  if (attendance.length === 0) return (
    <p className="py-6 text-center text-xs text-gray-400 dark:text-gray-500">출결 기록이 없습니다</p>
  )

  const attMap = new Map(attendance.map((a) => [a.date, a.status]))
  const months = [...new Set(attendance.map((a) => a.date.substring(0, 7)))].sort().reverse()

  const DOW = ['일', '월', '화', '수', '목', '금', '토']
  const STATUS_COLOR: Record<string, string> = {
    present: 'bg-emerald-500 text-white',
    late:    'bg-amber-400 text-white',
    absent:  'bg-rose-400 text-white',
  }

  return (
    <div className="space-y-5">
      {months.map((monthStr) => {
        const [year, month] = monthStr.split('-').map(Number)
        const daysInMonth = new Date(year, month, 0).getDate()
        const startDow = new Date(year, month - 1, 1).getDay()

        const cells: (number | null)[] = []
        for (let i = 0; i < startDow; i++) cells.push(null)
        for (let d = 1; d <= daysInMonth; d++) cells.push(d)

        const toDateStr = (d: number) =>
          `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`

        return (
          <div key={monthStr}>
            <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
              {year}년 {month}월
            </p>
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {DOW.map((d) => (
                <div key={d} className="pb-1 text-[10px] font-medium text-gray-400 dark:text-gray-400">{d}</div>
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
          </div>
        )
      })}

      <div className="flex gap-4 pt-1">
        {[['bg-emerald-500', '출석'], ['bg-amber-400', '지각'], ['bg-rose-400', '결석']].map(([color, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${color}`} />
            <span className="text-[11px] text-gray-500 dark:text-gray-300">{label}</span>
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
      <Sun className="h-3.5 w-3.5 text-amber-400 dark:text-gray-600 transition-colors" />
      <button
        role="switch"
        aria-checked={isDark}
        onClick={onToggle}
        className={`relative h-6 w-11 rounded-full transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          isDark ? 'bg-indigo-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
            isDark ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      <Moon className="h-3.5 w-3.5 text-gray-400 dark:text-indigo-400 transition-colors" />
    </div>
  )
}
