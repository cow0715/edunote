'use client'

import { use, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap, BookOpen, BookText, ClipboardCheck, UserCheck, ChevronDown, ChevronUp } from 'lucide-react'
import { TrendItem } from '@/components/share/score-trend-chart'
import { WeeklyBarItem } from '@/components/share/weekly-bar-chart'

const ScoreTrendChart = dynamic(
  () => import('@/components/share/score-trend-chart').then((m) => m.ScoreTrendChart),
  { ssr: false }
)
const WrongTypePieChart = dynamic(
  () => import('@/components/share/wrong-type-pie-chart').then((m) => m.WrongTypePieChart),
  { ssr: false }
)
const WeeklyBarChart = dynamic(
  () => import('@/components/share/weekly-bar-chart').then((m) => m.WeeklyBarChart),
  { ssr: false }
)

type Week = {
  id: string
  class_id: string
  week_number: number
  start_date: string | null
  vocab_total: number
  reading_total: number
  homework_total: number
}
type WeekScore = {
  id: string
  week_id: string
  reading_correct: number
  vocab_correct: number
  homework_done: number
  memo: string | null
}
type StudentAnswer = {
  id: string
  week_score_id: string
  is_correct: boolean
  exam_question: {
    id: string
    week_id: string
    exam_type: 'reading' | 'vocab' | null
    concept_tag: { id: string; name: string } | null
  } | null
}
type AttendanceRecord = { id: string; class_id: string; date: string; status: 'present' | 'late' | 'absent' }
type ShareData = {
  student: { id: string; name: string; school: string | null; grade: string | null }
  classes: { id: string; name: string }[]
  weeks: Week[]
  weekScores: WeekScore[]
  studentAnswers: StudentAnswer[]
  attendance: AttendanceRecord[]
}

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

function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; color: string
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

const ATT_STYLE: Record<string, string> = {
  present: 'bg-green-50 text-green-700 border-green-200',
  late:    'bg-amber-50 text-amber-700 border-amber-200',
  absent:  'bg-red-50 text-red-600 border-red-200',
}
const ATT_LABEL: Record<string, string> = { present: '출석', late: '지각', absent: '결석' }

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const { data, isLoading, error } = useShareData(token)
  const [expandedWeekId, setExpandedWeekId] = useState<string | null>(null)

  if (isLoading) return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
  if (error || !data) return (
    <div className="flex min-h-screen items-center justify-center text-gray-400">
      학생 정보를 찾을 수 없습니다
    </div>
  )

  const { student, classes, weeks, weekScores, studentAnswers, attendance = [] } = data

  // ── 기본 맵 ────────────────────────────────────────────────────────
  const scoreByWeek = new Map(weekScores.map((s) => [s.week_id, s]))
  const answersByScore = new Map<string, StudentAnswer[]>()
  studentAnswers.forEach((a) => {
    const list = answersByScore.get(a.week_score_id) ?? []
    list.push(a)
    answersByScore.set(a.week_score_id, list)
  })

  // 주차 + 성적 병합 (성적 있는 것만)
  const scoredWeeks = weeks
    .filter((w) => scoreByWeek.has(w.id))
    .sort((a, b) => a.week_number - b.week_number)

  // ── 요약 스탯 ──────────────────────────────────────────────────────
  const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null

  const readingRates = scoredWeeks
    .map((w) => {
      const s = scoreByWeek.get(w.id)!
      return w.reading_total > 0 ? Math.round((s.reading_correct / w.reading_total) * 100) : null
    })
    .filter((v): v is number => v !== null)

  const vocabRates = scoredWeeks
    .map((w) => w.vocab_total > 0 ? Math.round((scoreByWeek.get(w.id)!.vocab_correct / w.vocab_total) * 100) : null)
    .filter((v): v is number => v !== null)

  const homeworkRates = scoredWeeks
    .map((w) => w.homework_total > 0 ? Math.round((scoreByWeek.get(w.id)!.homework_done / w.homework_total) * 100) : null)
    .filter((v): v is number => v !== null)

  const totalAttendance = attendance.length
  const presentCount = attendance.filter((a) => a.status === 'present').length
  const lateCount = attendance.filter((a) => a.status === 'late').length
  const absentCount = attendance.filter((a) => a.status === 'absent').length

  // ── 추이 차트 데이터 ───────────────────────────────────────────────
  const trendData: TrendItem[] = scoredWeeks.map((w) => {
    const s = scoreByWeek.get(w.id)!
    const readingRate = w.reading_total > 0 ? Math.round((s.reading_correct / w.reading_total) * 100) : null
    const vocabRate = w.vocab_total > 0 ? Math.round((s.vocab_correct / w.vocab_total) * 100) : null
    return { label: `${w.week_number}주`, readingRate, vocabRate }
  })

  const barData: WeeklyBarItem[] = scoredWeeks.map((w) => {
    const s = scoreByWeek.get(w.id)!
    const item: WeeklyBarItem = { label: `${w.week_number}주` }
    if (w.vocab_total > 0) item['단어'] = Math.round((s.vocab_correct / w.vocab_total) * 100)
    if (w.homework_total > 0) item['숙제'] = Math.round((s.homework_done / w.homework_total) * 100)
    return item
  })

  // ── 전체 오답 유형 (파이 차트용) ───────────────────────────────────
  const typeWrongMap = new Map<string, { name: string; wrong: number; total: number }>()
  studentAnswers
    .filter((a) => a.exam_question?.exam_type === 'reading' && a.exam_question?.concept_tag)
    .forEach((a) => {
      const name = a.exam_question!.concept_tag!.name
      const entry = typeWrongMap.get(name) ?? { name, wrong: 0, total: 0 }
      entry.total += 1
      if (!a.is_correct) entry.wrong += 1
      typeWrongMap.set(name, entry)
    })
  const typeData = [...typeWrongMap.values()]
    .filter((d) => d.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong)

  // ── 주차별 틀린 유형 ────────────────────────────────────────────────
  function getWeekWrongTypes(weekId: string) {
    const score = scoreByWeek.get(weekId)
    if (!score) return []
    const answers = answersByScore.get(score.id) ?? []
    const map = new Map<string, number>()
    answers
      .filter((a) => !a.is_correct && a.exam_question?.exam_type === 'reading' && a.exam_question?.concept_tag)
      .forEach((a) => {
        const name = a.exam_question!.concept_tag!.name
        map.set(name, (map.get(name) ?? 0) + 1)
      })
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }

  // ── 출결 맵 (날짜 기준) ────────────────────────────────────────────
  const attByDate = new Map(attendance.map((a) => [a.date, a]))

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="font-semibold text-gray-800">학습 현황</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">

        {/* 학생 정보 */}
        <div className="rounded-xl border bg-white px-5 py-4">
          <h1 className="text-xl font-bold text-gray-900">{student.name}</h1>
          {(student.school || student.grade) && (
            <p className="mt-0.5 text-sm text-gray-500">
              {[student.school, student.grade].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {/* 요약 스탯 */}
        {weekScores.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {avg(readingRates) !== null && (
              <StatCard label="시험 평균" value={`${avg(readingRates)}%`}
                icon={<BookOpen className="h-4 w-4 text-indigo-600" />} color="bg-indigo-50" />
            )}
            {avg(vocabRates) !== null && (
              <StatCard label="단어 평균" value={`${avg(vocabRates)}%`}
                icon={<BookText className="h-4 w-4 text-green-600" />} color="bg-green-50" />
            )}
            {avg(homeworkRates) !== null && (
              <StatCard label="숙제 완료율" value={`${avg(homeworkRates)}%`}
                icon={<ClipboardCheck className="h-4 w-4 text-amber-600" />} color="bg-amber-50" />
            )}
            {totalAttendance > 0 && (
              <StatCard label="출석률"
                value={`${Math.round(((presentCount + lateCount) / totalAttendance) * 100)}%`}
                sub={`결석 ${absentCount}회`}
                icon={<UserCheck className="h-4 w-4 text-purple-600" />} color="bg-purple-50" />
            )}
          </div>
        )}

        {/* 차트 섹션 */}
        {(typeData.length > 0 || barData.some((d) => d['단어'] || d['숙제'])) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {typeData.length > 0 && (
              <div className="rounded-xl border bg-white p-4">
                <h2 className="mb-1 text-sm font-semibold text-gray-800">오답 유형 분포</h2>
                <p className="mb-3 text-xs text-gray-400">전체 누적 · 오답 횟수 기준</p>
                <WrongTypePieChart data={typeData} />
              </div>
            )}
            {barData.some((d) => d['단어'] !== undefined || d['숙제'] !== undefined) && (
              <div className="rounded-xl border bg-white p-4">
                <h2 className="mb-1 text-sm font-semibold text-gray-800">단어 · 숙제 추이</h2>
                <p className="mb-3 text-xs text-gray-400">주차별 달성률 (%)</p>
                <WeeklyBarChart data={barData} />
              </div>
            )}
          </div>
        )}

        {/* 시험 점수 추이 */}
        {trendData.length >= 2 && (
          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">시험 점수 추이</h2>
            <ScoreTrendChart data={trendData} />
          </div>
        )}

        {/* 회차별 박스 */}
        {scoredWeeks.length > 0 && (
          <div className="rounded-xl border bg-white">
            <div className="border-b px-5 py-3">
              <h2 className="text-sm font-semibold text-gray-800">회차별 성적</h2>
            </div>
            <div className="divide-y">
              {[...scoredWeeks].reverse().map((w) => {
                const score = scoreByWeek.get(w.id)!
                const className = classes.find((c) => c.id === w.class_id)?.name ?? ''
                const isExpanded = expandedWeekId === w.id
                const wrongTypes = isExpanded ? getWeekWrongTypes(w.id) : []

                // 해당 주차 날짜에 매칭되는 출결
                const attRecord = w.start_date ? attByDate.get(w.start_date) : undefined

                return (
                  <div key={w.id}>
                    <button
                      type="button"
                      className="w-full px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
                      onClick={() => setExpandedWeekId(isExpanded ? null : w.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {className} {w.week_number}주차
                          </span>
                          {w.start_date && (
                            <span className="text-xs text-gray-400">
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
                          ? <ChevronUp className="h-4 w-4 text-gray-400" />
                          : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>

                      {/* 점수 요약 */}
                      <div className="mt-2 flex flex-wrap gap-3">
                        {w.reading_total > 0 && (
                          <span className="flex items-center gap-1 text-xs text-gray-600">
                            <BookOpen className="h-3 w-3 text-indigo-400" />
                            시험 <strong className={`ml-0.5 ${score.reading_correct / w.reading_total >= 0.8 ? 'text-green-600' : score.reading_correct / w.reading_total >= 0.6 ? 'text-amber-500' : 'text-red-500'}`}>
                              {score.reading_correct}/{w.reading_total}
                            </strong>
                          </span>
                        )}
                        {w.vocab_total > 0 && (
                          <span className="flex items-center gap-1 text-xs text-gray-600">
                            <BookText className="h-3 w-3 text-green-400" />
                            단어 <strong className="ml-0.5">{score.vocab_correct}/{w.vocab_total}</strong>
                          </span>
                        )}
                        {w.homework_total > 0 && (
                          <span className="flex items-center gap-1 text-xs text-gray-600">
                            <ClipboardCheck className="h-3 w-3 text-amber-400" />
                            숙제 <strong className="ml-0.5">{score.homework_done}/{w.homework_total}</strong>
                          </span>
                        )}
                      </div>
                    </button>

                    {/* 확장: 틀린 유형 */}
                    {isExpanded && (
                      <div className="border-t bg-gray-50 px-5 py-4">
                        {wrongTypes.length > 0 ? (
                          <div>
                            <p className="mb-2 text-xs font-medium text-gray-500">이번 회차 오답 유형</p>
                            <div className="flex flex-wrap gap-2">
                              {wrongTypes.map(([name, count]) => (
                                <span key={name} className="flex items-center gap-1 rounded-full bg-red-50 border border-red-100 px-3 py-1 text-xs text-red-700 font-medium">
                                  {name}
                                  <span className="ml-0.5 rounded-full bg-red-100 px-1.5 text-[10px]">{count}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">
                            {w.reading_total > 0 ? '오답이 없거나 유형이 설정되지 않았습니다' : '시험 데이터가 없습니다'}
                          </p>
                        )}
                        {score.memo && (
                          <div className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                            💬 {score.memo}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 출결 이력 */}
        {attendance.length > 0 && (
          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">출결 현황</h2>
            <div className="mb-3 flex gap-4 text-sm">
              <span>출석 <strong className="text-green-600">{presentCount}</strong>회</span>
              <span>지각 <strong className="text-amber-600">{lateCount}</strong>회</span>
              <span>결석 <strong className="text-red-500">{absentCount}</strong>회</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[...attendance].slice(0, 12).map((a) => (
                <div key={a.id} className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs ${ATT_STYLE[a.status]}`}>
                  <span>{new Date(a.date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
                  <span>{ATT_LABEL[a.status]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {weekScores.length === 0 && (
          <div className="rounded-xl border bg-white p-10 text-center text-sm text-gray-400">
            아직 시험 결과가 없습니다
          </div>
        )}

      </main>
    </div>
  )
}
