'use client'

import { use } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap, TrendingUp, TrendingDown, Minus, BookOpen, BookText, ClipboardCheck, Calendar } from 'lucide-react'
import { TrendItem } from '@/components/share/score-trend-chart'

const ScoreTrendChart = dynamic(
  () => import('@/components/share/score-trend-chart').then((m) => m.ScoreTrendChart),
  { ssr: false }
)
const ConceptWeakChart = dynamic(
  () => import('@/components/share/concept-weak-chart').then((m) => m.ConceptWeakChart),
  { ssr: false }
)

type Week = { id: string; class_id: string; week_number: number; start_date: string | null; vocab_total: number; homework_total: number }
type WeekScore = { id: string; week_id: string; vocab_correct: number; homework_done: number; memo: string | null }
type StudentAnswer = {
  id: string
  week_score_id: string
  is_correct: boolean
  student_answer: number | null
  exam_question: {
    id: string
    week_id: string
    exam_type: 'reading' | 'vocab' | null
    question_type: { id: string; name: string } | null
    concept_tag: { id: string; name: string } | null
  } | null
}
type ShareData = {
  student: { id: string; name: string; school: string | null; grade: string | null }
  classes: { id: string; name: string }[]
  weeks: Week[]
  weekScores: WeekScore[]
  studentAnswers: StudentAnswer[]
  questions: { id: string; week_id: string }[]
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
  label: string
  value: string
  sub?: string
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs font-medium text-gray-600">{pct}%</span>
    </div>
  )
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const { data, isLoading, error } = useShareData(token)

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

  const { student, classes, weeks, weekScores, studentAnswers } = data

  // 기본 맵
  const scoreMap = new Map(weekScores.map((s) => [s.week_id, s]))
  const answersByScore = new Map<string, StudentAnswer[]>()
  studentAnswers.forEach((a) => {
    const list = answersByScore.get(a.week_score_id) ?? []
    list.push(a)
    answersByScore.set(a.week_score_id, list)
  })

  const scoredWeeks = weeks.filter((w) => scoreMap.has(w.id))

  // ── 주차별 추이 데이터 (독해/단어 분리) ──────────────────────────
  const trendData: TrendItem[] = scoredWeeks.map((w) => {
    const score = scoreMap.get(w.id)!
    const answers = answersByScore.get(score.id) ?? []
    const readingAns = answers.filter((a) => a.exam_question?.exam_type === 'reading')
    const readingRate = readingAns.length > 0
      ? Math.round((readingAns.filter((a) => a.is_correct).length / readingAns.length) * 100)
      : null
    const vocabRate = w.vocab_total > 0
      ? Math.round((score.vocab_correct / w.vocab_total) * 100)
      : null
    return { label: `${w.week_number}주`, readingRate, vocabRate }
  })

  // ── 요약 스탯 ──────────────────────────────────────────────────────
  const readingRates = trendData.map((d) => d.readingRate).filter((v): v is number => v !== null)
  const vocabRates = trendData.map((d) => d.vocabRate).filter((v): v is number => v !== null)
  const homeworkRates = scoredWeeks
    .filter((w) => w.homework_total > 0)
    .map((w) => {
      const s = scoreMap.get(w.id)!
      return Math.round((s.homework_done / w.homework_total) * 100)
    })

  const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
  const avgReading = avg(readingRates)
  const avgVocab = avg(vocabRates)
  const avgHomework = avg(homeworkRates)

  // 최근 트렌드 (독해 기준)
  const recentTrend = readingRates.length >= 2
    ? readingRates[readingRates.length - 1] - readingRates[readingRates.length - 2]
    : null

  // ── 최신 주차 하이라이트 ───────────────────────────────────────────
  const latestWeek = scoredWeeks.length > 0 ? scoredWeeks[scoredWeeks.length - 1] : null
  const latestScore = latestWeek ? scoreMap.get(latestWeek.id)! : null
  const latestAnswers = latestScore ? (answersByScore.get(latestScore.id) ?? []) : []
  const latestReading = latestAnswers.filter((a) => a.exam_question?.exam_type === 'reading')
  const latestReadingCorrect = latestReading.filter((a) => a.is_correct).length
  const latestClassName = latestWeek ? (classes.find((c) => c.id === latestWeek.class_id)?.name ?? '') : ''

  // ── 유형별 오답 분석 (독해 문제만) ────────────────────────────────
  const typeWrongMap = new Map<string, { name: string; wrong: number; total: number }>()
  studentAnswers
    .filter((a) => a.exam_question?.exam_type === 'reading')
    .forEach((a) => {
      const typeName = a.exam_question?.concept_tag?.name ?? a.exam_question?.question_type?.name
      if (!typeName) return
      const entry = typeWrongMap.get(typeName) ?? { name: typeName, wrong: 0, total: 0 }
      entry.total += 1
      if (!a.is_correct) entry.wrong += 1
      typeWrongMap.set(typeName, entry)
    })

  const typeData = [...typeWrongMap.values()]
    .filter((d) => d.total >= 2)
    .map((d) => ({ ...d, rate: Math.round((d.wrong / d.total) * 100) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8)

  // ── 최근 5주 이력 ──────────────────────────────────────────────────
  const recentWeeks = [...scoredWeeks].reverse().slice(0, 5)

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
        <div className="rounded-xl border bg-white px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{student.name}</h1>
            {(student.school || student.grade) && (
              <p className="mt-0.5 text-sm text-gray-500">
                {[student.school, student.grade].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="text-right text-sm text-gray-500">
            <p>총 <strong className="text-gray-900">{weekScores.length}회</strong> 응시</p>
            {recentTrend !== null && (
              <p className={`mt-1 flex items-center justify-end gap-0.5 text-xs font-medium ${
                recentTrend > 0 ? 'text-green-600' : recentTrend < 0 ? 'text-red-500' : 'text-gray-400'
              }`}>
                {recentTrend > 0
                  ? <><TrendingUp className="h-3.5 w-3.5" /> +{recentTrend}%p</>
                  : recentTrend < 0
                  ? <><TrendingDown className="h-3.5 w-3.5" /> {recentTrend}%p</>
                  : <><Minus className="h-3.5 w-3.5" /> 유지</>}
              </p>
            )}
          </div>
        </div>

        {/* 요약 스탯 */}
        {weekScores.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {avgReading !== null && (
              <StatCard
                label="독해 평균"
                value={`${avgReading}%`}
                sub={`전체 ${readingRates.length}회 기준`}
                icon={<BookOpen className="h-4 w-4 text-indigo-600" />}
                color="bg-indigo-50"
              />
            )}
            {avgVocab !== null && (
              <StatCard
                label="단어 평균"
                value={`${avgVocab}%`}
                sub={`전체 ${vocabRates.length}회 기준`}
                icon={<BookText className="h-4 w-4 text-green-600" />}
                color="bg-green-50"
              />
            )}
            {avgHomework !== null && (
              <StatCard
                label="숙제 완료율"
                value={`${avgHomework}%`}
                icon={<ClipboardCheck className="h-4 w-4 text-amber-600" />}
                color="bg-amber-50"
              />
            )}
            <StatCard
              label="총 응시"
              value={`${weekScores.length}회`}
              sub={`수업 ${classes.length}개`}
              icon={<Calendar className="h-4 w-4 text-blue-600" />}
              color="bg-blue-50"
            />
          </div>
        )}

        {/* 이번 주 성적 하이라이트 */}
        {latestWeek && latestScore && (
          <div className="rounded-xl border bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">
                {latestClassName} {latestWeek.week_number}주차 성적
              </h2>
              {latestWeek.start_date && (
                <span className="text-xs text-gray-400">
                  {new Date(latestWeek.start_date).toLocaleDateString('ko-KR')}
                </span>
              )}
            </div>
            <div className="space-y-4">
              {latestReading.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <BookOpen className="h-3.5 w-3.5 text-indigo-500" />독해
                    </span>
                    <span className="font-medium text-gray-800">
                      {latestReadingCorrect}/{latestReading.length}
                      <span className="ml-1 text-xs text-gray-400">
                        ({Math.round((latestReadingCorrect / latestReading.length) * 100)}%)
                      </span>
                    </span>
                  </div>
                  <ProgressBar
                    value={latestReadingCorrect}
                    max={latestReading.length}
                    color={latestReadingCorrect / latestReading.length >= 0.8 ? 'bg-green-500' : latestReadingCorrect / latestReading.length >= 0.6 ? 'bg-amber-400' : 'bg-red-400'}
                  />
                </div>
              )}
              {latestWeek.vocab_total > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <BookText className="h-3.5 w-3.5 text-green-500" />단어
                    </span>
                    <span className="font-medium text-gray-800">
                      {latestScore.vocab_correct}/{latestWeek.vocab_total}
                      <span className="ml-1 text-xs text-gray-400">
                        ({Math.round((latestScore.vocab_correct / latestWeek.vocab_total) * 100)}%)
                      </span>
                    </span>
                  </div>
                  <ProgressBar
                    value={latestScore.vocab_correct}
                    max={latestWeek.vocab_total}
                    color={latestScore.vocab_correct / latestWeek.vocab_total >= 0.8 ? 'bg-green-500' : latestScore.vocab_correct / latestWeek.vocab_total >= 0.6 ? 'bg-amber-400' : 'bg-red-400'}
                  />
                </div>
              )}
              {latestWeek.homework_total > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <ClipboardCheck className="h-3.5 w-3.5 text-amber-500" />숙제
                    </span>
                    <span className="font-medium text-gray-800">
                      {latestScore.homework_done}/{latestWeek.homework_total}
                    </span>
                  </div>
                  <ProgressBar
                    value={latestScore.homework_done}
                    max={latestWeek.homework_total}
                    color="bg-amber-400"
                  />
                </div>
              )}
              {latestScore.memo && (
                <div className="mt-1 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                  💬 {latestScore.memo}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 점수 추이 */}
        {trendData.length >= 2 && (
          <div className="rounded-xl border bg-white p-5">
            <h2 className="mb-4 font-semibold text-gray-800">점수 추이</h2>
            <ScoreTrendChart data={trendData} />
          </div>
        )}

        {/* 유형별 오답 분석 */}
        {typeData.length > 0 && (
          <div className="rounded-xl border bg-white p-5">
            <h2 className="mb-1 font-semibold text-gray-800">유형별 오답 분석</h2>
            <p className="mb-4 text-xs text-gray-400">독해 문제 기준 · 오답률 높은 순</p>
            <ConceptWeakChart data={typeData} />
          </div>
        )}

        {/* 최근 시험 이력 */}
        {recentWeeks.length > 0 && (
          <div className="rounded-xl border bg-white p-5">
            <h2 className="mb-4 font-semibold text-gray-800">시험 이력</h2>
            <div className="space-y-2">
              {recentWeeks.map((w, i) => {
                const score = scoreMap.get(w.id)!
                const answers = answersByScore.get(score.id) ?? []
                const readingAns = answers.filter((a) => a.exam_question?.exam_type === 'reading')
                const readingCorrect = readingAns.filter((a) => a.is_correct).length
                const className = classes.find((c) => c.id === w.class_id)?.name ?? ''
                const rate = readingAns.length > 0 ? Math.round((readingCorrect / readingAns.length) * 100) : null
                const isLatest = i === 0

                return (
                  <div key={w.id} className={`rounded-lg px-4 py-3 ${isLatest ? 'bg-indigo-50 border border-indigo-100' : 'bg-gray-50'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {className} {w.week_number}주차
                          {isLatest && <span className="ml-2 text-xs font-normal text-indigo-500">최근</span>}
                        </p>
                        {w.start_date && (
                          <p className="text-xs text-gray-400">{new Date(w.start_date).toLocaleDateString('ko-KR')}</p>
                        )}
                      </div>
                      <div className="text-right">
                        {rate !== null && (
                          <p className={`text-base font-bold ${rate >= 80 ? 'text-green-600' : rate >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                            독해 {readingCorrect}/{readingAns.length}
                            <span className="ml-1 text-xs font-normal text-gray-400">({rate}%)</span>
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">
                          {w.vocab_total > 0 && `단어 ${score.vocab_correct}/${w.vocab_total}`}
                          {w.vocab_total > 0 && w.homework_total > 0 && ' · '}
                          {w.homework_total > 0 && `숙제 ${score.homework_done}/${w.homework_total}`}
                        </p>
                      </div>
                    </div>
                    {score.memo && (
                      <p className="mt-2 text-xs text-gray-500 border-t border-gray-200 pt-2">
                        💬 {score.memo}
                      </p>
                    )}
                  </div>
                )
              })}
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
