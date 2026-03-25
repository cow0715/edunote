'use client'

import { Moon, Sun, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { AttendanceRecord } from './share-types'

// ── 공통 카드 ──────────────────────────────────────────────────────────────
export function Card({ title, subtitle, children, noPad }: {
  title?: string; subtitle?: string; children: React.ReactNode; noPad?: boolean
}) {
  return (
    <div className="rounded-2xl bg-white dark:bg-[#16161f] shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10">
      {title && (
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-300">{subtitle}</p>}
        </div>
      )}
      <div className={noPad ? '' : 'px-5 pb-5'}>{children}</div>
    </div>
  )
}

// ── 스탯 카드 ──────────────────────────────────────────────────────────────
export function StatCard({ label, value, delta, icon, color }: {
  label: string; value: string | null; delta: number | null
  icon: React.ReactNode; color: 'indigo' | 'emerald' | 'amber' | 'blue'
}) {
  const c = {
    indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-900/40',   icon: 'text-indigo-500 dark:text-indigo-300',   val: 'text-indigo-700 dark:text-indigo-200'   },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/40', icon: 'text-emerald-500 dark:text-emerald-300', val: 'text-emerald-700 dark:text-emerald-200' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-900/40',     icon: 'text-amber-500 dark:text-amber-300',     val: 'text-amber-700 dark:text-amber-200'     },
    blue:    { bg: 'bg-blue-50 dark:bg-blue-900/40',       icon: 'text-blue-500 dark:text-blue-300',       val: 'text-blue-700 dark:text-blue-200'       },
  }[color]

  return (
    <div className="rounded-2xl bg-white dark:bg-[#16161f] shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10 px-4 py-4">
      <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-xl ${c.bg}`}>
        <span className={c.icon}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold ${c.val}`}>{value ?? '-'}</p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-300">{label}</p>
      {delta !== null && (
        <div className={`mt-2 flex items-center gap-0.5 text-xs font-medium ${
          delta > 0 ? 'text-emerald-500 dark:text-emerald-400' : delta < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-gray-400 dark:text-gray-400'
        }`}>
          {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          <span>{delta > 0 ? '+' : ''}{delta}% 지난주</span>
        </div>
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
