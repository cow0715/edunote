'use client'

import { use } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { GraduationCap } from 'lucide-react'

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

  const { student, classes, weeks, weekScores, studentAnswers, questions } = data

  const scoreMap = new Map(weekScores.map((s) => [s.week_id, s]))
  const questionCountMap = new Map<string, number>()
  questions.forEach((q) => {
    questionCountMap.set(q.week_id, (questionCountMap.get(q.week_id) ?? 0) + 1)
  })

  const answersByScore = new Map<string, StudentAnswer[]>()
  studentAnswers.forEach((a) => {
    const list = answersByScore.get(a.week_score_id) ?? []
    list.push(a)
    answersByScore.set(a.week_score_id, list)
  })

  // 주차별 점수 추이 (전체 exam_type 합산)
  const trendData = weeks
    .filter((w) => scoreMap.has(w.id))
    .map((w) => {
      const score = scoreMap.get(w.id)!
      const answers = answersByScore.get(score.id) ?? []
      const correct = answers.filter((a) => a.is_correct).length
      const total = questionCountMap.get(w.id) || answers.length
      const className = classes.find((c) => c.id === w.class_id)?.name ?? ''
      return {
        label: `${className} ${w.week_number}주`,
        rate: total > 0 ? Math.round((correct / total) * 100) : 0,
        correct,
        total,
      }
    })
    .filter((d) => d.total > 0)

  // 개선 추이 indicator
  const recentTrend = trendData.length >= 2
    ? trendData[trendData.length - 1].rate - trendData[trendData.length - 2].rate
    : null

  // 문제 유형별 오답률 집계
  const typeWrongMap = new Map<string, { name: string; wrong: number; total: number }>()
  studentAnswers.forEach((a) => {
    const typeName = a.exam_question?.concept_tag?.name ?? a.exam_question?.question_type?.name
    if (!typeName) return
    const entry = typeWrongMap.get(typeName) ?? { name: typeName, wrong: 0, total: 0 }
    entry.total += 1
    if (!a.is_correct) entry.wrong += 1
    typeWrongMap.set(typeName, entry)
  })

  const typeData = [...typeWrongMap.values()]
    .filter((d) => d.total >= 3)
    .map((d) => ({ ...d, rate: Math.round((d.wrong / d.total) * 100) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8)

  const recentWeeks = [...weeks].filter((w) => scoreMap.has(w.id)).reverse().slice(0, 5)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="font-semibold text-gray-800">학습 현황</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        {/* 학생 정보 */}
        <div className="rounded-xl border bg-white p-5">
          <h1 className="text-xl font-bold text-gray-900">{student.name}</h1>
          {(student.school || student.grade) && (
            <p className="mt-1 text-sm text-gray-500">
              {[student.school, student.grade].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="mt-3 flex gap-4 text-sm text-gray-600">
            <span>수강 수업 <strong>{classes.length}개</strong></span>
            <span>응시 <strong>{weekScores.length}회</strong></span>
          </div>
        </div>

        {/* 점수 추이 */}
        {trendData.length >= 1 && (
          <div className="rounded-xl border bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="font-semibold text-gray-800">점수 추이</h2>
              {recentTrend !== null && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  recentTrend > 0
                    ? 'bg-green-100 text-green-700'
                    : recentTrend < 0
                    ? 'bg-red-100 text-red-600'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {recentTrend > 0 ? `▲ +${recentTrend}%p` : recentTrend < 0 ? `▼ ${recentTrend}%p` : '→ 유지'}
                </span>
              )}
            </div>
            <ScoreTrendChart data={trendData} />
          </div>
        )}

        {/* 유형별 오답 분석 */}
        {typeData.length > 0 && (
          <div className="rounded-xl border bg-white p-5">
            <h2 className="mb-1 font-semibold text-gray-800">유형별 오답 분석</h2>
            <p className="mb-4 text-xs text-gray-400">문제 유형 기준 · 오답률 높은 순</p>
            <ConceptWeakChart data={typeData} />
          </div>
        )}

        {/* 최근 시험 결과 */}
        {recentWeeks.length > 0 && (
          <div className="rounded-xl border bg-white p-5">
            <h2 className="mb-4 font-semibold text-gray-800">최근 시험 결과</h2>
            <div className="space-y-3">
              {recentWeeks.map((w) => {
                const score = scoreMap.get(w.id)!
                const answers = answersByScore.get(score.id) ?? []
                const total = questionCountMap.get(w.id) || answers.length
                const correct = answers.filter((a) => a.is_correct).length
                const className = classes.find((c) => c.id === w.class_id)?.name ?? ''
                const rate = total > 0 ? Math.round((correct / total) * 100) : null

                return (
                  <div key={w.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{className} {w.week_number}주차</p>
                      {w.start_date && <p className="text-xs text-gray-400">{w.start_date}</p>}
                    </div>
                    <div className="text-right">
                      {rate !== null && (
                        <p className={`text-lg font-bold ${rate >= 80 ? 'text-green-600' : rate >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                          {correct}/{total}
                          <span className="ml-1 text-sm font-normal text-gray-400">({rate}%)</span>
                        </p>
                      )}
                      <div className="flex gap-3 justify-end text-xs text-gray-400">
                        {w.vocab_total > 0 && <span>단어 {score.vocab_correct}/{w.vocab_total}</span>}
                        {w.homework_total > 0 && <span>숙제 {score.homework_done}/{w.homework_total}</span>}
                      </div>
                    </div>
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
