'use client'

import { use, useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import {
  GraduationCap, BookOpen, BookText, ClipboardCheck, UserCheck,
  ChevronDown, ChevronUp, X,
  Home, BarChart2, PieChart, MessageSquare, BookX, AlertTriangle,
} from 'lucide-react'
import { classifyPatterns } from '@/hooks/weakness/useAnalysis'
import { ShareData, StudentAnswer, VocabAnswer, TabId, CIRCLE_NUM } from './share-types'
import { Card, StatCard, AttendanceCalendar, ThemeToggle } from './share-components'
import { PatternCard } from './share-pattern'

import { TrendItem } from '@/components/share/score-trend-chart'
import { HomeworkItem } from '@/components/share/homework-bar-chart'
import { RadarItem } from '@/components/share/concept-radar-chart'

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
const ConceptRadarChart = dynamic(
  () => import('@/components/share/concept-radar-chart').then((m) => m.ConceptRadarChart),
  { ssr: false }
)

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
  const [expandedWrongWeekIds, setExpandedWrongWeekIds] = useState<Set<string>>(new Set())
  const [expandedVocabWeekIds, setExpandedVocabWeekIds] = useState<Set<string>>(new Set())
  const [drawerTag, setDrawerTag] = useState<{ id: string; name: string; weekId?: string | null } | null>(null)
  const [isDark, setIsDark] = useState(false)
  const [themeReady, setThemeReady] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [wrongNoteTab, setWrongNoteTab] = useState<'reading' | 'vocab'>('reading')
  const [commentExpanded, setCommentExpanded] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('share-theme')
    if (saved) {
      setIsDark(saved === 'dark')
    } else {
      setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
    }
    setThemeReady(true)
  }, [])

  // 데이터 로드 후 오답 탭 최근 주차 기본 열림
  useEffect(() => {
    if (!data) return
    const sorted = [...(data.weeks ?? [])]
      .filter((w) => data.weekScores.some((s) => s.week_id === w.id))
      .sort((a, b) => b.week_number - a.week_number)
    if (sorted[0]) setExpandedWrongWeekIds(new Set([sorted[0].id]))
    if (sorted[0]) setExpandedVocabWeekIds(new Set([sorted[0].id]))
  }, [data])

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

  const { student, classes, weeks, weekScores = [], studentAnswers = [], vocabAnswers = [], attendance = [], classAverages = {} } = data

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

  function weekRate(score: (typeof weekScores)[number], week: (typeof weeks)[number], field: 'reading' | 'vocab' | 'homework'): number | null {
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

  // ── 카테고리별 정답률 (레이더 차트) ──────────────────────────────────────
  const categoryAccMap = new Map<string, { name: string; correct: number; total: number }>()
  studentAnswers
    .filter((a) => a.exam_question?.exam_type === 'reading')
    .forEach((a) => {
      for (const t of a.exam_question?.exam_question_tag ?? []) {
        const tag = t.concept_tag
        if (!tag?.category_name) continue
        const key = tag.category_id ?? tag.category_name
        const entry = categoryAccMap.get(key) ?? { name: tag.category_name, correct: 0, total: 0 }
        entry.total++
        if (a.is_correct) entry.correct++
        categoryAccMap.set(key, entry)
      }
    })
  const radarData: RadarItem[] = [...categoryAccMap.values()]
    .filter((d) => d.total >= 2)
    .map((d) => ({ name: d.name, rate: Math.round(d.correct / d.total * 100), correct: d.correct, total: d.total }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── 반복 오답 패턴 (약점 분류) ──────────────────────────────────────────
  const repeatPatterns = classifyPatterns(studentAnswers, weekNumberByWeekId)

  // ── 성장 하이라이트 ───────────────────────────────────────────────────────
  const highlights: { emoji: string; label: string; color: string }[] = []
  const dReading = delta('reading')
  const dVocab   = delta('vocab')
  const dHw      = delta('homework')
  if (dReading !== null && dReading > 0)
    highlights.push({ emoji: '📈', label: `시험 ${dReading}%↑`, color: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-800/40' })
  if (dVocab !== null && dVocab > 0)
    highlights.push({ emoji: '✏️', label: `단어 ${dVocab}%↑`, color: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-800/40' })
  if (dHw !== null && dHw > 0)
    highlights.push({ emoji: '📝', label: `과제 ${dHw}%↑`, color: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-800/40' })
  if (latestW && latestS && weekRate(latestS, latestW, 'homework') === 100)
    highlights.push({ emoji: '🎯', label: '과제 완벽 제출', color: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-800/40' })
  if (attRate !== null && attRate >= 90)
    highlights.push({ emoji: '🏃', label: `출석 ${attRate}%`, color: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-100 dark:border-blue-800/40' })
  const improvingTags = repeatPatterns.filter((p) => p.patternType === 'improving')
  if (improvingTags.length > 0)
    highlights.push({ emoji: '🌱', label: `${improvingTags[0].name} 개선 중`, color: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-800/40' })

  // ── 오답노트 탭 데이터 ────────────────────────────────────────────────────
  const wrongNoteGroups = visibleWeeks
    .map((w) => {
      const score = scoreByWeek.get(w.id)
      if (!score) return null
      const answers = (answersByScore.get(score.id) ?? [])
        .filter((a) => !a.is_correct && a.exam_question?.exam_type === 'reading')
        .sort((a, b) => {
          const qa = a.exam_question!, qb = b.exam_question!
          if (qa.question_number !== qb.question_number) return qa.question_number - qb.question_number
          return (qa.sub_label ?? '').localeCompare(qb.sub_label ?? '')
        })
      if (answers.length === 0) return null
      return { week: w, answers, className: classes.find((c) => c.id === w.class_id)?.name ?? '' }
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)

  // ── 단어 오답 그룹 ────────────────────────────────────────────────────────
  const scoreIdToWeekId = new Map(weekScores.map((s) => [s.id, s.week_id]))
  const vocabWrongMap = new Map<string, VocabAnswer[]>()
  vocabAnswers.forEach((va) => {
    const weekId = scoreIdToWeekId.get(va.week_score_id)
    if (!weekId) return
    const list = vocabWrongMap.get(weekId) ?? []
    list.push(va)
    vocabWrongMap.set(weekId, list)
  })
  const vocabWrongGroups: { week: (typeof weeks)[number]; answers: VocabAnswer[]; className: string }[] = []
  for (const [weekId, answers] of vocabWrongMap.entries()) {
    const week = weeks.find((w) => w.id === weekId)
    if (!week) continue
    const className = classes.find((c) => c.id === week.class_id)?.name ?? ''
    vocabWrongGroups.push({ week, answers, className })
  }
  vocabWrongGroups.sort((a, b) => b.week.week_number - a.week.week_number)

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
    { id: 'home'      as TabId, label: '홈',   Icon: Home     },
    { id: 'score'     as TabId, label: '성적',  Icon: BarChart2 },
    { id: 'analysis'  as TabId, label: '분석',  Icon: PieChart  },
    { id: 'wrongnote' as TabId, label: '오답',  Icon: BookX     },
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
                    value={avg(readingRates) !== null ? `${avg(readingRates)}%` : null} delta={delta('reading')}
                    onClick={() => setActiveTab('score')} />
                  <StatCard label="단어 평균" icon={<BookText className="h-4 w-4" />} color="emerald"
                    value={avg(vocabRates) !== null ? `${avg(vocabRates)}%` : null} delta={delta('vocab')}
                    onClick={() => { setActiveTab('wrongnote'); setWrongNoteTab('vocab') }} />
                  <StatCard label="과제 평균" icon={<ClipboardCheck className="h-4 w-4" />} color="amber"
                    value={avg(homeworkRates) !== null ? `${avg(homeworkRates)}%` : null} delta={delta('homework')}
                    onClick={() => setActiveTab('score')} />
                  <StatCard label="출석률" icon={<UserCheck className="h-4 w-4" />} color="blue"
                    value={attRate !== null ? `${attRate}%` : null} delta={null}
                    onClick={() => setActiveTab('score')} />
                </div>
              )}

              {/* 성장 하이라이트 */}
              {highlights.length > 0 && (
                <div className="rounded-2xl bg-white dark:bg-[#16161f] shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/[0.08] px-5 py-4">
                  <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">이번 주 잘한 것</p>
                  <div className="flex flex-wrap gap-2">
                    {highlights.map((h, i) => (
                      <span key={i} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${h.color}`}>
                        <span>{h.emoji}</span>
                        {h.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 강사 코멘트 */}
              {commentFeed.length > 0 && (
                <Card title="강사 코멘트" subtitle="최근 수업 피드백">
                  <div className="space-y-3">
                    {(commentExpanded ? commentFeed : commentFeed.slice(0, 1)).map(({ week, memo, className }, idx, arr) => (
                      <div key={week.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50">
                            <MessageSquare className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" />
                          </div>
                          {(commentExpanded || idx < arr.length - 1) && (
                            <div className="mt-1 flex-1 w-px bg-gray-100 dark:bg-white/[0.12]" />
                          )}
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
                    {commentFeed.length > 1 && (
                      <button
                        onClick={() => setCommentExpanded((v) => !v)}
                        className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:underline"
                      >
                        {commentExpanded
                          ? <><ChevronUp className="h-3.5 w-3.5" /> 접기</>
                          : <><ChevronDown className="h-3.5 w-3.5" /> 이전 코멘트 {commentFeed.length - 1}개 더 보기</>}
                      </button>
                    )}
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

              {homeworkData.length >= 1 && (
                <Card title="과제 제출률" subtitle="주차별 (%)">
                  <HomeworkBarChart data={homeworkData} isDark={isDark} />
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
                      const attRecord = w.start_date ? attByDate.get(w.start_date) : undefined

                      return (
                        <div key={w.id} className="px-5 py-4">
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
                          </div>

                          {score ? (
                            <>
                              <div className="mt-2.5 flex flex-wrap gap-2">
                                {w.reading_total > 0 && score.reading_correct !== null && (
                                  <span className="flex items-center gap-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 px-2 py-1 text-xs">
                                    <BookOpen className="h-3 w-3 text-indigo-400 dark:text-indigo-500" />
                                    <span className="text-gray-600 dark:text-gray-300">시험</span>
                                    <strong className={`ml-0.5 ${scoreColor(score.reading_correct ?? 0, w.reading_total)}`}>
                                      {score.reading_correct ?? 0}/{w.reading_total}
                                    </strong>
                                    {(() => {
                                      const avg = classAverages[w.id]?.readingRate
                                      const my = weekRate(score, w, 'reading')
                                      if (avg === null || avg === undefined || my === null) return null
                                      const diff = my - avg
                                      return (
                                        <span className={`ml-1 text-[10px] font-medium ${diff > 0 ? 'text-emerald-500 dark:text-emerald-400' : diff < 0 ? 'text-rose-400 dark:text-rose-400' : 'text-gray-400'}`}>
                                          반 평균 {diff > 0 ? '+' : ''}{diff}%
                                        </span>
                                      )
                                    })()}
                                  </span>
                                )}
                                {w.vocab_total > 0 && score.vocab_correct !== null && (
                                  <span className="flex items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-xs">
                                    <BookText className="h-3 w-3 text-emerald-500 dark:text-emerald-600" />
                                    <span className="text-gray-600 dark:text-gray-300">단어</span>
                                    <strong className={`ml-0.5 ${scoreColor(score.vocab_correct, w.vocab_total)}`}>
                                      {score.vocab_correct}/{w.vocab_total}
                                    </strong>
                                    {(() => {
                                      const avg = classAverages[w.id]?.vocabRate
                                      const my = weekRate(score, w, 'vocab')
                                      if (avg === null || avg === undefined || my === null) return null
                                      const diff = my - avg
                                      return (
                                        <span className={`ml-1 text-[10px] font-medium ${diff > 0 ? 'text-emerald-500 dark:text-emerald-400' : diff < 0 ? 'text-rose-400 dark:text-rose-400' : 'text-gray-400'}`}>
                                          반 평균 {diff > 0 ? '+' : ''}{diff}%
                                        </span>
                                      )
                                    })()}
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
                                <div className="mt-3 rounded-xl border border-indigo-100 dark:border-indigo-800/40 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3">
                                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-400 dark:text-indigo-500">강사 코멘트</p>
                                  <p className="text-sm leading-relaxed text-indigo-800 dark:text-indigo-300">{score.memo}</p>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">성적 미입력</p>
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
              {radarData.length >= 3 && (
                <Card title="영역별 정답률" subtitle="카테고리별 누적 정답률">
                  <ConceptRadarChart data={radarData} isDark={isDark} />
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

              {repeatPatterns.length > 0 && (
                <Card title="약점 패턴 분석" subtitle="출제된 주차 기준 · 클릭하면 문제 확인">
                  <div className="space-y-2">
                    {repeatPatterns.map((p) => (
                      <PatternCard key={p.id} pattern={p} onTagClick={(id, name) => setDrawerTag({ id, name, weekId: null })} />
                    ))}
                  </div>
                </Card>
              )}

              {typeData.length === 0 && repeatPatterns.length === 0 && (
                <div className="rounded-2xl bg-white dark:bg-[#16161f] p-10 text-center text-sm text-gray-400 dark:text-gray-400 shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/[0.08]">
                  분석 데이터가 없습니다
                </div>
              )}
            </>
          )}

          {/* ── 오답노트 탭 ──────────────────────────────────────────── */}
          {activeTab === 'wrongnote' && (
            <>
              {/* 독해 / 단어 토글 */}
              <div className="flex rounded-xl bg-gray-100 dark:bg-white/[0.06] p-1">
                {(['reading', 'vocab'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setWrongNoteTab(t)}
                    className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${
                      wrongNoteTab === t
                        ? 'bg-white dark:bg-[#16161f] text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {t === 'reading' ? '진단평가' : '단어'}
                  </button>
                ))}
              </div>

              {/* 독해 오답 */}
              {wrongNoteTab === 'reading' && (
                wrongNoteGroups.length === 0 ? (
                  <div className="rounded-2xl bg-white dark:bg-[#16161f] p-10 text-center text-sm text-gray-400 dark:text-gray-400 shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10">
                    진단평가 오답 데이터가 없습니다
                  </div>
                ) : (
                  <Card noPad>
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
                      {wrongNoteGroups.map(({ week, answers, className }) => {
                        const isOpen = expandedWrongWeekIds.has(week.id)
                        const toggle = () => setExpandedWrongWeekIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(week.id)) next.delete(week.id)
                          else next.add(week.id)
                          return next
                        })
                        return (
                          <div key={week.id}>
                            <button
                              type="button"
                              onClick={toggle}
                              className="w-full px-5 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {className} {week.week_number}주차
                                  </span>
                                  {week.start_date && (
                                    <span className="text-xs text-gray-400 dark:text-gray-400">
                                      {new Date(week.start_date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                                    </span>
                                  )}
                                  <span className="rounded-full bg-rose-100 dark:bg-rose-950/60 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                                    {answers.length}문제
                                  </span>
                                </div>
                                {isOpen
                                  ? <ChevronUp className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" />
                                  : <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" />}
                              </div>
                            </button>

                            {isOpen && (
                              <div className="border-t border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0d0d14] px-4 py-4 space-y-3">
                                {answers.map((a) => {
                                  const q = a.exam_question!
                                  const tags = q.exam_question_tag.map((t) => t.concept_tag).filter(Boolean)
                                  return (
                                    <div key={a.id} className="rounded-xl bg-white dark:bg-[#16161f] ring-1 ring-gray-100 dark:ring-white/[0.08] p-4">
                                      <div className="flex items-start justify-between gap-2 mb-3">
                                        <span className="text-sm font-bold text-gray-900 dark:text-white shrink-0">
                                          {q.question_number}번{q.sub_label ? ` (${q.sub_label})` : ''}
                                        </span>
                                        <div className="flex flex-wrap gap-1 justify-end">
                                          {tags.map((tag) => (
                                            <span key={tag!.id} className="rounded-full bg-indigo-50 dark:bg-indigo-900/40 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300">
                                              {tag!.name}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                      {q.question_text && (
                                        <div className="mb-3 rounded-lg bg-gray-50 dark:bg-[#0d0d14] border border-gray-100 dark:border-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-line">
                                          {q.question_text}
                                        </div>
                                      )}
                                      <div className="space-y-1.5 mb-3">
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-xs text-gray-400 dark:text-gray-400">내 답</span>
                                          <span className="text-sm font-semibold text-rose-500 dark:text-rose-400 break-words">{formatMyAnswer(a)}</span>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-xs text-gray-400 dark:text-gray-400">정답</span>
                                          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 break-words">{formatCorrectAnswer(q)}</span>
                                        </div>
                                      </div>
                                      {a.ai_feedback && (
                                        <p className="mb-2.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                          {a.ai_feedback}
                                        </p>
                                      )}
                                      {q.explanation && (
                                        <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 px-3 py-2.5 text-xs leading-relaxed text-indigo-700 dark:text-indigo-300">
                                          {q.explanation}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                )
              )}

              {/* 단어 오답 */}
              {wrongNoteTab === 'vocab' && (
                vocabWrongGroups.length === 0 ? (
                  <div className="rounded-2xl bg-white dark:bg-[#16161f] p-10 text-center text-sm text-gray-400 dark:text-gray-400 shadow-sm dark:shadow-none dark:ring-1 dark:ring-white/10">
                    단어 오답 데이터가 없습니다
                  </div>
                ) : (
                  <Card noPad>
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
                      {vocabWrongGroups.map(({ week, answers, className }) => {
                        const isOpen = expandedVocabWeekIds.has(week.id)
                        const toggle = () => setExpandedVocabWeekIds((prev) => {
                          const next = new Set(prev)
                          if (next.has(week.id)) next.delete(week.id)
                          else next.add(week.id)
                          return next
                        })
                        return (
                          <div key={week.id}>
                            <button
                              type="button"
                              onClick={toggle}
                              className="w-full px-5 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {className} {week.week_number}주차
                                  </span>
                                  {week.start_date && (
                                    <span className="text-xs text-gray-400 dark:text-gray-400">
                                      {new Date(week.start_date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                                    </span>
                                  )}
                                  <span className="rounded-full bg-rose-100 dark:bg-rose-950/60 px-2 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                                    {answers.length}개
                                  </span>
                                </div>
                                {isOpen
                                  ? <ChevronUp className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" />
                                  : <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-400" />}
                              </div>
                            </button>

                            {isOpen && (
                              <div className="border-t border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-[#0d0d14] divide-y divide-gray-100 dark:divide-white/[0.08]">
                                {answers
                                  .slice()
                                  .sort((a, b) => (a.vocab_word?.number ?? 0) - (b.vocab_word?.number ?? 0))
                                  .map((va) => {
                                    const vw = va.vocab_word
                                    if (!vw) return null
                                    return (
                                      <div key={va.id} className="px-5 py-3">
                                        <div className="flex items-baseline justify-between gap-2">
                                          <span className="text-sm font-bold text-gray-900 dark:text-white">{vw.english_word}</span>
                                          <span className="text-xs text-gray-400 dark:text-gray-500">#{vw.number}</span>
                                        </div>
                                        <div className="mt-1.5 flex items-center gap-2">
                                          <span className="text-sm text-rose-500 dark:text-rose-400 line-through">
                                            {va.student_answer || '미답'}
                                          </span>
                                          <span className="text-gray-300 dark:text-gray-600 text-xs">→</span>
                                          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                                            {vw.correct_answer || '—'}
                                          </span>
                                        </div>
                                        {(vw.synonyms?.length ?? 0) > 0 && (
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {(vw.synonyms ?? []).map((s) => (
                                              <span key={s} className="rounded-full border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[11px] text-blue-700 dark:text-blue-300">
                                                유 {s}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        {(vw.antonyms?.length ?? 0) > 0 && (
                                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                                            {(vw.antonyms ?? []).map((s) => (
                                              <span key={s} className="rounded-full border border-purple-200 dark:border-purple-800/40 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 text-[11px] text-purple-700 dark:text-purple-300">
                                                반 {s}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                )
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
          className={`fixed bottom-0 left-1/2 z-50 flex max-h-[82vh] w-full max-w-lg -translate-x-1/2 flex-col rounded-t-2xl bg-white dark:bg-[#16161f] transition-transform duration-300 ease-out ${drawerTag ? 'translate-y-0' : 'translate-y-full'}`}
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

          <div className="overflow-y-auto overscroll-contain px-5 py-4 space-y-3">
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
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-gray-400 dark:text-gray-400">내 답</span>
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 break-words">{formatMyAnswer(a)}</span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-gray-400 dark:text-gray-400">정답</span>
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 break-words">{formatCorrectAnswer(q)}</span>
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
