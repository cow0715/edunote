'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'
import { AttendanceCalendar, Card, StatCard, SwipeChartCard } from '../share-components'
import { ShareModel } from '../use-share-model'
import { ShareData } from '../share-types'
import { avg, fmtShortDate, fmtWeekLabel, getWeekLabel } from '../share-utils'

const HomeworkBarChart = dynamic(
  () => import('@/components/share/homework-bar-chart').then((m) => m.HomeworkBarChart),
  { ssr: false }
)

export function HomeTab({
  student,
  model,
  isDark,
  onOpenWrongNote,
  onScrollTo,
  onGoScoreSection,
}: {
  student: ShareData['student']
  model: ShareModel
  isDark: boolean
  onOpenWrongNote: (kind: 'reading' | 'vocab') => void
  onScrollTo: (id: string, delay?: number) => void
  onGoScoreSection: (id: string) => void
}) {
  const [attendanceView, setAttendanceView] = useState<'regular' | 'clinic'>('regular')
  const [commentExpanded, setCommentExpanded] = useState(false)

  const {
    weekScores, latestW, latestS, weekRate, deltas,
    readingRates, vocabRates, homeworkRates,
    attendance, clinicAttendance, attRate, clinicAttRate,
    totalAtt, presentAtt, totalClinicAtt, presentClinicAtt,
    highlights, homeworkData, commentFeed,
  } = model

  const hasAttendanceData = attendance.length > 0 || clinicAttendance.length > 0
  const primaryAttRate = attRate ?? clinicAttRate
  const visibleAttendanceView = attendanceView === 'clinic'
    ? (clinicAttendance.length > 0 ? 'clinic' : 'regular')
    : (attendance.length > 0 ? 'regular' : 'clinic')

  return (
    <>
      {/* 히어로 카드 */}
      <div className="rounded-3xl bg-white px-8 py-8 shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:bg-[#1E293B] dark:shadow-none dark:ring-1 dark:ring-white/[0.06]">
        <div className="mb-8">
          <p className="mb-2 text-sm text-[#8B95A1] dark:text-[#94A3B8]">
            {[student.grade, student.school].filter(Boolean).join(' · ') || '학습 현황'}
          </p>
          <h1 className="text-2xl font-bold text-[#1A1C1E] dark:text-[#F8FAFC]">{student.name}</h1>
        </div>

        {weekScores.length > 0 && latestW && latestS ? (
          <div>
            <p className="mb-4 text-sm text-[#8B95A1] dark:text-[#94A3B8]">
              최근 시험 · {fmtWeekLabel(latestW)}
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                className="flex-1 rounded-2xl bg-blue-50 px-4 py-3 text-left transition-transform active:scale-[0.98] dark:bg-blue-950/40"
                onClick={() => onOpenWrongNote('reading')}
              >
                <p className="mb-1 text-xs font-semibold text-[#2463EB] dark:text-blue-400">시험</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-[40px] font-black leading-none text-[#2463EB] dark:text-blue-300">
                    {weekRate(latestS, latestW, 'reading') ?? '-'}
                  </span>
                  {weekRate(latestS, latestW, 'reading') !== null && (
                    <span className="text-lg font-bold text-[#2463EB]/60 dark:text-blue-400/60">%</span>
                  )}
                </div>
                {deltas.reading !== null && (
                  <p className={`mt-1 text-xs font-semibold ${deltas.reading > 0 ? 'text-[#2463EB] dark:text-blue-400' : deltas.reading < 0 ? 'text-rose-500' : 'text-[#8B95A1]'}`}>
                    {deltas.reading > 0 ? '+' : ''}{deltas.reading}%p
                  </p>
                )}
              </button>

              <button
                type="button"
                className="flex-1 rounded-2xl bg-emerald-50 px-4 py-3 text-left transition-transform active:scale-[0.98] dark:bg-emerald-950/40"
                onClick={() => onOpenWrongNote('vocab')}
              >
                <p className="mb-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">단어</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-[40px] font-black leading-none text-emerald-600 dark:text-emerald-400">
                    {weekRate(latestS, latestW, 'vocab') ?? '-'}
                  </span>
                  {weekRate(latestS, latestW, 'vocab') !== null && (
                    <span className="text-lg font-bold text-emerald-600/60 dark:text-emerald-400/60">%</span>
                  )}
                </div>
                {deltas.vocab !== null && (
                  <p className={`mt-1 text-xs font-semibold ${deltas.vocab > 0 ? 'text-emerald-600 dark:text-emerald-400' : deltas.vocab < 0 ? 'text-rose-500' : 'text-[#8B95A1]'}`}>
                    {deltas.vocab > 0 ? '+' : ''}{deltas.vocab}%p
                  </p>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-[#8B95A1] dark:text-[#94A3B8]">최근 시험 점수</p>
            <span className="text-[56px] font-black leading-none text-[#8B95A1] dark:text-gray-600">-</span>
            <p className="mt-4 text-sm text-[#8B95A1] dark:text-gray-500">아직 시험 결과가 없습니다</p>
          </div>
        )}
      </div>

      {/* 스탯 카드 */}
      {weekScores.length > 0 && (() => {
        const avgReading = avg(readingRates)
        const avgVocab = avg(vocabRates)
        const avgHomework = avg(homeworkRates)
        const latestReading = latestW && latestS ? weekRate(latestS, latestW, 'reading') : null
        const latestVocab = latestW && latestS ? weekRate(latestS, latestW, 'vocab') : null
        const latestHomework = latestW && latestS ? weekRate(latestS, latestW, 'homework') : null
        const vsAvgReading = latestReading !== null && avgReading !== null ? latestReading - avgReading : null
        const vsAvgVocab = latestVocab !== null && avgVocab !== null ? latestVocab - avgVocab : null
        const vsAvgHomework = latestHomework !== null && avgHomework !== null ? latestHomework - avgHomework : null
        return (
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="시험 평균" color="indigo"
              value={avgReading !== null ? `${avgReading}%` : null} delta={vsAvgReading}
              onClick={() => onGoScoreSection('section-reading-chart')} />
            <StatCard label="단어 평균" color="emerald"
              value={avgVocab !== null ? `${avgVocab}%` : null} delta={vsAvgVocab}
              onClick={() => onGoScoreSection('section-vocab-chart')} />
            <StatCard label="과제 평균" color="amber"
              value={avgHomework !== null ? `${avgHomework}%` : null} delta={vsAvgHomework}
              onClick={() => onScrollTo('section-homework')} />
            <StatCard label="출결 현황" color="blue"
              value={primaryAttRate !== null ? `${primaryAttRate}%` : null} delta={null}
              onClick={() => onScrollTo('section-attendance')} />
          </div>
        )
      })()}

      {/* 성장 하이라이트 */}
      {highlights.length > 0 && (
        <div className="rounded-3xl bg-white px-5 py-4 shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:bg-[#1E293B] dark:shadow-none dark:ring-1 dark:ring-white/[0.06]">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8B95A1] dark:text-[#94A3B8]">이번 주 잘한 것</p>
          <div className="flex flex-wrap gap-2">
            {highlights.map((h, i) => (
              <span key={i} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${h.color}`}>
                <span>{h.emoji}</span>
                {h.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 과제 제출률 */}
      {homeworkData.length >= 1 && (
        <SwipeChartCard id="section-homework" title="과제 제출률" subtitle="주차별 (%)" itemCount={homeworkData.length}>
          <HomeworkBarChart data={homeworkData} isDark={isDark} />
        </SwipeChartCard>
      )}

      {/* 출석 현황 */}
      {hasAttendanceData && (
        <Card id="section-attendance" title="출결 현황">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-blue-50 px-3.5 py-3 dark:bg-blue-950/30">
                <p className="text-[11px] font-semibold text-[#8B95A1] dark:text-[#94A3B8]">정규수업</p>
                <p className="mt-1 text-2xl font-black text-[#2463EB] dark:text-[#3B82F6]">
                  {attRate !== null ? `${attRate}%` : '-'}
                </p>
                <p className="mt-0.5 text-[11px] text-[#8B95A1] dark:text-[#94A3B8]">
                  {totalAtt > 0 ? `${presentAtt}/${totalAtt}회 출석` : '기록 없음'}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-3.5 py-3 dark:bg-slate-900/50">
                <p className="text-[11px] font-semibold text-[#8B95A1] dark:text-[#94A3B8]">클리닉</p>
                <p className="mt-1 text-2xl font-black text-[#1A1C1E] dark:text-[#F8FAFC]">
                  {clinicAttRate !== null ? `${clinicAttRate}%` : '-'}
                </p>
                <p className="mt-0.5 text-[11px] text-[#8B95A1] dark:text-[#94A3B8]">
                  {totalClinicAtt > 0 ? `${presentClinicAtt}/${totalClinicAtt}회 출석` : '기록 없음'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 rounded-full bg-slate-100 p-1 dark:bg-slate-900/70">
              {[
                { id: 'regular' as const, label: '정규수업', disabled: attendance.length === 0 },
                { id: 'clinic' as const, label: '클리닉', disabled: clinicAttendance.length === 0 },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAttendanceView(item.id)}
                  disabled={item.disabled}
                  className={`rounded-full px-3 py-2 text-xs font-bold transition-all disabled:opacity-40 ${
                    visibleAttendanceView === item.id
                      ? 'bg-white text-[#2463EB] shadow-sm dark:bg-[#1E293B] dark:text-[#3B82F6]'
                      : 'text-[#8B95A1] dark:text-[#94A3B8]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <AttendanceCalendar
              attendance={visibleAttendanceView === 'clinic' ? clinicAttendance : attendance}
              variant={visibleAttendanceView}
            />
          </div>
        </Card>
      )}

      {/* 강사 코멘트 */}
      {commentFeed.length > 0 && (
        <Card title="추쌤 코멘트 💬" subtitle="최근 수업 피드백">
          <div className="space-y-3">
            {(commentExpanded ? commentFeed : commentFeed.slice(0, 1)).map(({ week, memo, className }, idx, arr) => (
              <div key={week.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
                    <MessageSquare className="h-3.5 w-3.5 text-[#2463EB] dark:text-blue-300" />
                  </div>
                  {(commentExpanded || idx < arr.length - 1) && (
                    <div className="mt-1 w-px flex-1 bg-gray-100 dark:bg-white/[0.12]" />
                  )}
                </div>
                <div className="min-w-0 pb-3">
                  <p className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">
                    {className} {getWeekLabel(week)}
                    {week.start_date && <span className="ml-1.5">{fmtShortDate(week.start_date)}</span>}
                  </p>
                  <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{memo}</p>
                </div>
              </div>
            ))}
            {commentFeed.length > 1 && (
              <button
                type="button"
                onClick={() => setCommentExpanded((v) => !v)}
                aria-expanded={commentExpanded}
                className="flex items-center gap-1 text-xs text-[#2463EB] hover:underline dark:text-blue-400"
              >
                {commentExpanded
                  ? <><ChevronUp className="h-3.5 w-3.5" /> 접기</>
                  : <><ChevronDown className="h-3.5 w-3.5" /> 이전 코멘트 {commentFeed.length - 1}개 더 보기</>}
              </button>
            )}
          </div>
        </Card>
      )}
    </>
  )
}
