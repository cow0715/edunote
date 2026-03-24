'use client'

import { use, useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import {
  GraduationCap, BookOpen, BookText, ClipboardCheck, UserCheck,
  ChevronDown, ChevronUp, ChevronRight, X, TrendingUp, TrendingDown, Minus,
  Moon, Sun, Home, BarChart2, PieChart, MessageSquare,
} from 'lucide-react'

function ThemeToggle({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
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
import { TrendItem } from '@/components/share/score-trend-chart'
import { HomeworkItem } from '@/components/share/homework-bar-chart'

const ScoreTrendChart = dynamic(
  () => import('@/components/share/score-trend-chart').then((m) => m.ScoreTrendChart),
  { ssr: false }
)
const HomeworkBarChart = dynamic(
  () => import('@/components/share/homework-bar-chart').then((m) => m.HomeworkBarChart),
  { ssr: false }
)
const WrongTypePieChart = dynamic(
  () => import('@/components/share/wrong-type-pie-chart').then((m) => m.WrongTypePieChart),
  { ssr: false }
)

// ── 타입 ──────────────────────────────────────────────────────────────────────
type Week = {
  id: string; class_id: string; week_number: number; start_date: string | null
  vocab_total: number; reading_total: number; homework_total: number
}
type WeekScore = {
  id: string; week_id: string
  reading_correct: number; vocab_correct: number | null; homework_done: number | null; memo: string | null
}
type ConceptTag = { id: string; name: string; category_id: string | null; category_name: string | null }
type StudentAnswer = {
  id: string; week_score_id: string; is_correct: boolean
  student_answer: number | null; student_answer_text: string | null; ai_feedback: string | null
  exam_question: {
    id: string; week_id: string; question_number: number; sub_label: string | null
    exam_type: 'reading' | 'vocab' | null; question_style: string
    correct_answer: number | null; correct_answer_text: string | null
    explanation?: string | null; question_text?: string | null
    exam_question_tag: { concept_tag: ConceptTag | null }[]
  } | null
}
type AttendanceRecord = { id: string; class_id: string; date: string; status: 'present' | 'late' | 'absent' }
type ShareData = {
  student: { id: string; name: string; school: string | null; grade: string | null }
  classes: { id: string; name: string }[]
  weeks: Week[]; weekScores: WeekScore[]; studentAnswers: StudentAnswer[]; attendance: AttendanceRecord[]
  classAverages: Record<string, { readingRate: number | null; vocabRate: number | null }>
}

const CIRCLE_NUM = ['①', '②', '③', '④', '⑤']
type TabId = 'home' | 'score' | 'analysis'

function useShareData(token: string) {
  return useQuery<ShareData>({
    queryKey: ['share', token],
    queryFn: async () => {
      const res = await fetch(`/api/share/${token}`)
      if (!res.ok) throw new Error('데이터를 불러올 수 없습니다')
      return res.json()
    },
  })
}

// ── 공통 카드 ──────────────────────────────────────────────────────────────
function Card({ title, subtitle, children, noPad }: {
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
function StatCard({ label, value, delta, icon, color }: {
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
function AttendanceCalendar({ attendance }: { attendance: AttendanceRecord[] }) {
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

// ── 오답 포맷 헬퍼 ──────────────────────────────────────────────────────────
function formatMyAnswer(a: StudentAnswer): string {
  const q = a.exam_question!
  if (q.question_style === 'objective') {
    return a.student_answer !== null ? (CIRCLE_NUM[a.student_answer - 1] ?? String(a.student_answer)) : '미답'
  }
  return a.student_answer_text?.trim() || '미답'
}

function formatCorrectAnswer(q: StudentAnswer['exam_question']): string {
  if (!q) return '?'
  if (q.question_style === 'objective') {
    return q.correct_answer !== null ? (CIRCLE_NUM[q.correct_answer - 1] ?? String(q.correct_answer)) : '?'
  }
  return q.correct_answer_text ?? '?'
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
export default function ShareClient({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const { data, isLoading, error } = useShareData(token)
  const [expandedWeekId, setExpandedWeekId] = useState<string | null>(null)
  const [drawerTag, setDrawerTag] = useState<{ id: string; name: string; weekId?: string | null } | null>(null)
  const [isDark, setIsDark] = useState(false)
  const [themeReady, setThemeReady] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('home')

  useEffect(() => {
    const saved = localStorage.getItem('share-theme')
    if (saved) {
      setIsDark(saved === 'dark')
    } else {
      setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
    }
    setThemeReady(true)
  }, [])

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev
      localStorage.setItem('share-theme', next ? 'dark' : 'light')
      return next
    })
  }

  if (isLoading) return (
    <div className={themeReady && isDark ? 'dark' : ''}>
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-[#0f1117]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    </div>
  )
  if (error || !data) return (
    <div className={themeReady && isDark ? 'dark' : ''}>
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-[#0f1117] text-sm text-gray-400 dark:text-gray-500">
        학생 정보를 찾을 수 없습니다
      </div>
    </div>
  )

  const { student, classes, weeks, weekScores = [], studentAnswers = [], attendance = [], classAverages = {} } = data

  const scoreByWeek = new Map(weekScores.map((s) => [s.week_id, s]))
  const answersByScore = new Map<string, StudentAnswer[]>()
  studentAnswers.forEach((a) => {
    const list = answersByScore.get(a.week_score_id) ?? []
    list.push(a)
    answersByScore.set(a.week_score_id, list)
  })
  const weekNumberByWeekId = new Map(weeks.map((w) => [w.id, w.week_number]))

  const scoredWeeks = weeks.filter((w) => scoreByWeek.has(w.id)).sort((a, b) => a.week_number - b.week_number)
  const visibleWeeks = [...scoredWeeks].reverse()

  // ── 스탯 계산 ────────────────────────────────────────────────────────────
  const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null

  const hasReadingData = (weekId: string, scoreId: string) => {
    const s = scoreByWeek.get(weekId)!
    return (answersByScore.get(scoreId)?.some((a) => a.exam_question?.exam_type === 'reading') ?? false) || s.reading_correct > 0
  }

  function weekRate(score: WeekScore, week: Week, field: 'reading' | 'vocab' | 'homework'): number | null {
    if (field === 'reading') return week.reading_total > 0 && hasReadingData(week.id, score.id) ? Math.round(score.reading_correct / week.reading_total * 100) : null
    if (field === 'vocab') return week.vocab_total > 0 && score.vocab_correct !== null ? Math.round(score.vocab_correct / week.vocab_total * 100) : null
    if (field === 'homework') return week.homework_total > 0 && score.homework_done !== null ? Math.round(score.homework_done / week.homework_total * 100) : null
    return null
  }

  const readingRates  = scoredWeeks.map((w) => weekRate(scoreByWeek.get(w.id)!, w, 'reading')).filter((v): v is number => v !== null)
  const vocabRates    = scoredWeeks.map((w) => weekRate(scoreByWeek.get(w.id)!, w, 'vocab')).filter((v): v is number => v !== null)
  const homeworkRates = scoredWeeks.map((w) => weekRate(scoreByWeek.get(w.id)!, w, 'homework')).filter((v): v is number => v !== null)

  const sorted2 = [...scoredWeeks].reverse()
  const [latestW, prevW] = [sorted2[0], sorted2[1]]
  const latestS = latestW ? scoreByWeek.get(latestW.id) : undefined
  const prevS   = prevW   ? scoreByWeek.get(prevW.id)   : undefined
  const delta = (field: 'reading' | 'vocab' | 'homework') => {
    const l = latestW && latestS ? weekRate(latestS, latestW, field) : null
    const p = prevW   && prevS   ? weekRate(prevS,   prevW,   field) : null
    return l !== null && p !== null ? l - p : null
  }

  const totalAtt   = attendance.length
  const presentAtt = attendance.filter((a) => a.status !== 'absent').length
  const attRate    = totalAtt > 0 ? Math.round(presentAtt / totalAtt * 100) : null

  // ── 차트 데이터 ────────────────────────────────────────────────────────────
  const trendData: TrendItem[] = weeks
    .slice().sort((a, b) => a.week_number - b.week_number)
    .map((w) => {
      const s = scoreByWeek.get(w.id)
      const ca = classAverages[w.id]
      return {
        label: `${w.week_number}주`,
        readingRate:      s ? weekRate(s, w, 'reading') : null,
        vocabRate:        s ? weekRate(s, w, 'vocab')   : null,
        classReadingRate: ca?.readingRate ?? null,
        classVocabRate:   ca?.vocabRate   ?? null,
      }
    })
    .filter((d) => d.readingRate !== null || d.vocabRate !== null || d.classReadingRate !== null || d.classVocabRate !== null)

  const homeworkData: HomeworkItem[] = scoredWeeks
    .map((w) => {
      const s = scoreByWeek.get(w.id)!
      if (w.homework_total === 0 || s.homework_done === null) return null
      return { label: `${w.week_number}주`, rate: Math.round(s.homework_done / w.homework_total * 100), done: s.homework_done, total: w.homework_total }
    })
    .filter((d): d is HomeworkItem => d !== null)

  const typeWrongMap = new Map<string, { id: string; name: string; wrong: number; total: number }>()
  studentAnswers.filter((a) => a.exam_question?.exam_type === 'reading').forEach((a) => {
    for (const t of a.exam_question?.exam_question_tag ?? []) {
      const tag = t.concept_tag
      if (!tag) continue
      const entry = typeWrongMap.get(tag.id) ?? { id: tag.id, name: tag.name, wrong: 0, total: 0 }
      entry.total++
      if (!a.is_correct) entry.wrong++
      typeWrongMap.set(tag.id, entry)
    }
  })
  const typeData = [...typeWrongMap.values()].filter((d) => d.wrong > 0).sort((a, b) => b.wrong - a.wrong)

  // ── 강사 코멘트 피드 ──────────────────────────────────────────────────────
  const commentFeed = visibleWeeks
    .filter((w) => scoreByWeek.get(w.id)?.memo)
    .map((w) => ({
      week: w,
      memo: scoreByWeek.get(w.id)!.memo!,
      className: classes.find((c) => c.id === w.class_id)?.name ?? '',
    }))

  // ── 주차 답안 ────────────────────────────────────────────────────────────
  function getWeekAnswers(weekId: string) {
    const score = scoreByWeek.get(weekId)
    if (!score) return { wrong: [] as StudentAnswer[], correct: [] as StudentAnswer[] }
    const answers = (answersByScore.get(score.id) ?? [])
      .filter((a) => a.exam_question?.exam_type === 'reading')
      .sort((a, b) => {
        const qa = a.exam_question, qb = b.exam_question
        if (!qa || !qb) return 0
        if (qa.question_number !== qb.question_number) return qa.question_number - qb.question_number
        return (qa.sub_label ?? '').localeCompare(qb.sub_label ?? '')
      })
    return { wrong: answers.filter((a) => !a.is_correct), correct: answers.filter((a) => a.is_correct) }
  }

  const scoreColor = (correct: number, total: number) =>
    total === 0 ? '' : correct / total >= 0.8
      ? 'text-emerald-600 dark:text-emerald-400'
      : correct / total >= 0.6
      ? 'text-amber-500 dark:text-amber-400'
      : 'text-rose-500 dark:text-rose-400'

  // ── 오답노트 드로어 ──────────────────────────────────────────────────────
  const drawerAnswers = drawerTag
    ? studentAnswers
        .filter((a) =>
          !a.is_correct &&
          a.exam_question?.exam_question_tag.some((t) => t.concept_tag?.id === drawerTag.id) &&
          (drawerTag.weekId ? a.exam_question?.week_id === drawerTag.weekId : true)
        )
        .sort((a, b) => {
          const wa = weekNumberByWeekId.get(a.exam_question?.week_id ?? '') ?? 0
          const wb = weekNumberByWeekId.get(b.exam_question?.week_id ?? '') ?? 0
          return wb - wa
        })
    : []

  const attByDate = new Map(attendance.map((a) => [a.date, a]))
  const ATT_STYLE: Record<string, string> = {
    present: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800/50',
    late:    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/50',
    absent:  'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800/50',
  }
  const ATT_LABEL: Record<string, string> = { present: '출석', late: '지각', absent: '결석' }

  const TABS = [
    { id: 'home'     as TabId, label: '홈',   Icon: Home     },
    { id: 'score'    as TabId, label: '성적',  Icon: BarChart2 },
    { id: 'analysis' as TabId, label: '분석',  Icon: PieChart  },
  ]

  return (
    <div className={themeReady && isDark ? 'dark' : ''}>
      <div className="min-h-screen bg-gray-50 dark:bg-[#0f1117]">

        {/* ── 헤더 ──────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 border-b border-gray-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#16161f]/90 backdrop-blur-sm px-4 py-3">
          <div className="mx-auto flex max-w-lg items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">학습 현황</span>
            </div>
            <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
          </div>
        </header>

        {/* ── 탭 콘텐츠 ─────────────────────────────────────────────── */}
        <main className="mx-auto max-w-lg px-4 pt-5 pb-28 space-y-4">

          {/* ── 홈 탭 ───────────────────────────────────────────────── */}
          {activeTab === 'home' && (
            <>
              {/* 프로필 */}
              <div className="rounded-2xl bg-white dark:bg-[#16161f] shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/[0.08] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-xl font-bold text-indigo-700 dark:text-indigo-200">
                    {student.name[0]}
                  </div>
                  <div>
                    <h1 className="text-lg font-bold text-gray-900 dark:text-white">{student.name}</h1>
                    {(student.school || student.grade) && (
                      <p className="text-xs text-gray-500 dark:text-gray-300">
                        {[student.grade, student.school].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* 스탯 카드 */}
              {weekScores.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="시험 평균" icon={<BookOpen className="h-4 w-4" />} color="indigo"
                    value={avg(readingRates) !== null ? `${avg(readingRates)}%` : null} delta={delta('reading')} />
                  <StatCard label="단어 평균" icon={<BookText className="h-4 w-4" />} color="emerald"
                    value={avg(vocabRates) !== null ? `${avg(vocabRates)}%` : null} delta={delta('vocab')} />
                  <StatCard label="과제 평균" icon={<ClipboardCheck className="h-4 w-4" />} color="amber"
                    value={avg(homeworkRates) !== null ? `${avg(homeworkRates)}%` : null} delta={delta('homework')} />
                  <StatCard label="출석률" icon={<UserCheck className="h-4 w-4" />} color="blue"
                    value={attRate !== null ? `${attRate}%` : null} delta={null} />
                </div>
              )}

              {/* 강사 코멘트 */}
              {commentFeed.length > 0 && (
                <Card title="강사 코멘트" subtitle="최근 수업 피드백">
                  <div className="space-y-3">
                    {commentFeed.map(({ week, memo, className }) => (
                      <div key={week.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50">
                            <MessageSquare className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" />
                          </div>
                          <div className="mt-1 flex-1 w-px bg-gray-100 dark:bg-white/[0.12]" />
                        </div>
                        <div className="pb-3 min-w-0">
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                            {className} {week.week_number}주차
                            {week.start_date && (
                              <span className="ml-1.5">
                                {new Date(week.start_date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                              </span>
                            )}
                          </p>
                          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{memo}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {weekScores.length === 0 && (
                <div className="rounded-2xl bg-white dark:bg-[#16161f] p-10 text-center text-sm text-gray-400 dark:text-gray-400 shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10">
                  아직 시험 결과가 없습니다
                </div>
              )}
            </>
          )}

          {/* ── 성적 탭 ─────────────────────────────────────────────── */}
          {activeTab === 'score' && (
            <>
              {trendData.length >= 1 && (
                <Card title="점수 추이" subtitle="시험·단어 정답률 (%) · 점선은 반 평균">
                  <ScoreTrendChart data={trendData} isDark={isDark} />
                </Card>
              )}

              {attendance.length > 0 && (
                <Card title="출석 현황" subtitle="수업일 기준">
                  <AttendanceCalendar attendance={attendance} />
                </Card>
              )}

              {visibleWeeks.length > 0 && (
                <Card title="회차별 성적" noPad>
                  <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
                    {visibleWeeks.map((w) => {
                      const score = scoreByWeek.get(w.id)
                      const className = classes.find((c) => c.id === w.class_id)?.name ?? ''
                      const isExpanded = expandedWeekId === w.id
                      const weekAnswers = isExpanded ? getWeekAnswers(w.id) : { wrong: [] as StudentAnswer[], correct: [] as StudentAnswer[] }
                      const attRecord = w.start_date ? attByDate.get(w.start_date) : undefined

                      const wrongTypesMap = new Map<string, { id: string; name: string; count: number }>()
                      if (isExpanded) {
                        weekAnswers.wrong.forEach((a) => {
                          a.exam_question?.exam_question_tag.forEach((t) => {
                            const tag = t.concept_tag
                            if (!tag) return
                            const entry = wrongTypesMap.get(tag.id) ?? { id: tag.id, name: tag.name, count: 0 }
                            entry.count++
                            wrongTypesMap.set(tag.id, entry)
                          })
                        })
                      }
                      const wrongTypesList = [...wrongTypesMap.values()].sort((a, b) => b.count - a.count)

                      return (
                        <div key={w.id}>
                          <button
                            type="button"
                            className="w-full px-5 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                            onClick={() => setExpandedWeekId(isExpanded ? null : w.id)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                  {className} {w.week_number}주차
                                </span>
                                {w.start_date && (
                                  <span className="text-xs text-gray-400 dark:text-gray-400">
                                    {new Date(w.start_date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                                  </span>
                                )}
                                {attRecord && (
                                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${ATT_STYLE[attRecord.status]}`}>
                                    {ATT_LABEL[attRecord.status]}
                                  </span>
                                )}
                              </div>
                              {isExpanded
                                ? <ChevronUp className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" />
                                : <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" />}
                            </div>

                            {score ? (() => {
                              const hasReadingAnswers =
                                (answersByScore.get(score.id)?.some((a) => a.exam_question?.exam_type === 'reading') ?? false)
                                || (score.reading_correct !== null && score.reading_correct > 0)
                              return (
                                <>
                                  <div className="mt-2.5 flex flex-wrap gap-2">
                                    {w.reading_total > 0 && (hasReadingAnswers || score.reading_correct !== null) && (
                                      <span className="flex items-center gap-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 px-2 py-1 text-xs">
                                        <BookOpen className="h-3 w-3 text-indigo-400 dark:text-indigo-500" />
                                        <span className="text-gray-600 dark:text-gray-300">시험</span>
                                        <strong className={`ml-0.5 ${scoreColor(score.reading_correct ?? 0, w.reading_total)}`}>
                                          {score.reading_correct ?? 0}/{w.reading_total}
                                        </strong>
                                      </span>
                                    )}
                                    {w.vocab_total > 0 && score.vocab_correct !== null && (
                                      <span className="flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-xs">
                                        <BookText className="h-3 w-3 text-emerald-500 dark:text-emerald-600" />
                                        <span className="text-gray-600 dark:text-gray-300">단어</span>
                                        <strong className={`ml-0.5 ${scoreColor(score.vocab_correct, w.vocab_total)}`}>
                                          {score.vocab_correct}/{w.vocab_total}
                                        </strong>
                                      </span>
                                    )}
                                    {w.homework_total > 0 && score.homework_done !== null && (
                                      <span className="flex items-center gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-2 py-1 text-xs">
                                        <ClipboardCheck className="h-3 w-3 text-amber-500 dark:text-amber-600" />
                                        <span className="text-gray-600 dark:text-gray-300">과제</span>
                                        <strong className={`ml-0.5 ${scoreColor(score.homework_done, w.homework_total)}`}>
                                          {score.homework_done}/{w.homework_total}
                                        </strong>
                                      </span>
                                    )}
                                  </div>
                                  {score.memo && (
                                    <p className="mt-2 truncate text-xs text-indigo-500 dark:text-indigo-400">
                                      💬 {score.memo}
                                    </p>
                                  )}
                                </>
                              )
                            })() : (
                              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">성적 미입력</p>
                            )}
                          </button>

                          {isExpanded && (
                            <div className="border-t border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0d0d14] px-5 py-4 space-y-3">
                              {wrongTypesList.length > 0 ? (
                                <div>
                                  <p className="mb-2.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                    오답 유형 <span className="font-normal text-gray-400 dark:text-gray-400">({weekAnswers.wrong.length}문항)</span>
                                  </p>
                                  <div className="space-y-1.5">
                                    {wrongTypesList.map(({ id, name, count }) => (
                                      <button
                                        key={id}
                                        onClick={() => setDrawerTag({ id, name, weekId: w.id })}
                                        className="flex w-full items-center justify-between rounded-xl border border-rose-100 dark:border-rose-900/40 bg-white dark:bg-[#16161f] px-3.5 py-2.5 text-left transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/20"
                                      >
                                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{name}</span>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <span className="rounded-full bg-rose-100 dark:bg-rose-950/60 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                                            {count}문제
                                          </span>
                                          <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-white/20" />
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 dark:text-gray-400">
                                  {score && (score.reading_correct > 0 || weekAnswers.correct.length > 0)
                                    ? '모두 정답입니다'
                                    : '시험 데이터가 없습니다'}
                                </p>
                              )}
                              {score?.memo && (
                                <div className="rounded-xl border border-indigo-100 dark:border-indigo-800/40 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3">
                                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-400 dark:text-indigo-500">강사 코멘트</p>
                                  <p className="text-sm leading-relaxed text-indigo-800 dark:text-indigo-300">{score.memo}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}

              {weekScores.length === 0 && (
                <div className="rounded-2xl bg-white dark:bg-[#16161f] p-10 text-center text-sm text-gray-400 dark:text-gray-400 shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10">
                  아직 시험 결과가 없습니다
                </div>
              )}
            </>
          )}

          {/* ── 분석 탭 ─────────────────────────────────────────────── */}
          {activeTab === 'analysis' && (
            <>
              {homeworkData.length >= 1 && (
                <Card title="과제 제출률" subtitle="주차별 (%)">
                  <HomeworkBarChart data={homeworkData} isDark={isDark} />
                </Card>
              )}

              {typeData.length > 0 && (
                <Card title="오답 유형 분포" subtitle="전체 누적 · 오답 횟수 기준">
                  <WrongTypePieChart
                    data={typeData}
                    onTagClick={(id, name) => setDrawerTag({ id, name, weekId: null })}
                    isDark={isDark}
                  />
                </Card>
              )}

              {homeworkData.length === 0 && typeData.length === 0 && (
                <div className="rounded-2xl bg-white dark:bg-[#16161f] p-10 text-center text-sm text-gray-400 dark:text-gray-400 shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/[0.08]">
                  분석 데이터가 없습니다

                </div>
              )}
            </>
          )}

        </main>

        {/* ── 하단 탭바 ─────────────────────────────────────────────── */}
        <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/90 dark:bg-[#16161f]/95 backdrop-blur-sm border-t border-gray-100 dark:border-white/10">
          <div className="mx-auto flex max-w-lg pb-safe">
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex flex-1 flex-col items-center gap-1 py-3 transition-colors ${
                    active
                      ? 'text-indigo-600 dark:text-indigo-300'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  <Icon className={`h-5 w-5 transition-transform ${active ? 'scale-110' : ''}`} />
                  <span className={`text-[10px] font-medium ${active ? 'font-semibold' : ''}`}>{label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* ── 오답노트 드로어 ──────────────────────────────────────── */}
        <div
          className={`fixed inset-0 z-40 bg-black/40 dark:bg-black/60 transition-opacity duration-300 ${drawerTag ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={() => setDrawerTag(null)}
        />

        <div
          className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] flex-col rounded-t-2xl bg-white dark:bg-[#16161f] transition-transform duration-300 ease-out ${drawerTag ? 'translate-y-0' : 'translate-y-full'}`}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-gray-200 dark:bg-white/20" />
          </div>

          <div className="flex items-center justify-between border-b border-gray-100 dark:border-white/[0.08] px-5 py-3">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">{drawerTag?.name} 오답노트</h3>
              <p className="text-xs text-gray-400 dark:text-gray-400">
                {drawerTag?.weekId ? '이번 주차' : '전체 누적'} · 총 {drawerAnswers.length}회 틀림
              </p>
            </div>
            <button
              onClick={() => setDrawerTag(null)}
              className="rounded-full p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08] hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-4 space-y-3">
            {drawerAnswers.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-400">오답 데이터가 없습니다</p>
            ) : (
              drawerAnswers.map((a) => {
                const q = a.exam_question!
                const weekNum = weekNumberByWeekId.get(q.week_id) ?? '?'
                return (
                  <div key={a.id} className="rounded-xl border border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0d0d14] p-4">
                    <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-300">
                      {weekNum}주차 · {q.question_number}번{q.sub_label ? ` (${q.sub_label})` : ''}
                    </p>

                    {q.question_text && (
                      <div className="mb-3 rounded-lg bg-white dark:bg-[#16161f] border border-gray-100 dark:border-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-line">
                        {q.question_text}
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="w-10 shrink-0 text-xs text-gray-400 dark:text-gray-400">내 답</span>
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">{formatMyAnswer(a)}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-10 shrink-0 text-xs text-gray-400 dark:text-gray-400">정답</span>
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{formatCorrectAnswer(q)}</span>
                      </div>
                      {a.ai_feedback && (
                        <div className="flex items-start gap-2">
                          <span className="w-10 shrink-0 text-xs text-gray-400 dark:text-gray-400">피드백</span>
                          <span className="text-xs leading-relaxed text-gray-600 dark:text-gray-200">{a.ai_feedback}</span>
                        </div>
                      )}
                      {q.explanation && (
                        <div className="mt-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 px-3 py-2.5 text-xs leading-relaxed text-indigo-700 dark:text-indigo-300">
                          {q.explanation}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            <div className="h-4" />
          </div>
        </div>

      </div>
    </div>
  )
}
