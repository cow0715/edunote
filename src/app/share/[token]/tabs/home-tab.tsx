'use client'

// 홈 탭 — "이번 주 한 장 리포트".
//
// 설계 원칙 (design.md §0, §4):
//   · 대시보드가 아니다. 학부모가 읽는 순서대로: 이번 주 한 문장 → 지표 3줄 → 오답 → 흐름 → 출결.
//   · 큰 숫자·색 타일·이모지 칩 없음. 색은 accent 하나(진행 막대·링크)만 쓴다.
//   · 선생님 코멘트가 있으면 헤드라인 바로 아래에 둔다 — 숫자보다 먼저 읽힌다.
//   · 차트는 성적 탭 몫이다. 홈은 스파크라인 이상을 그리지 않는다.

import { useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { AttendanceCalendar, Card, EmptyState } from '../share-components'
import { ShareModel, WeeklyReport } from '../use-share-model'
import { ShareData } from '../share-types'
import { WeeklyMetric, avg, fmtDelta, fmtShortDate, getWeekLabel } from '../share-utils'

const INK = 'text-[#1A1C1E] dark:text-[#F1F5F9]'
const BODY = 'text-[#3F4650] dark:text-[#CBD5E1]'
const MUTED = 'text-[#8B95A1]'
const ACCENT = 'text-[#2463EB] dark:text-[#3B82F6]'
const HAIRLINE = 'border-[#EEF0F3] dark:border-white/[0.06]'

export function HomeTab({
  student,
  model,
  onOpenWrongNote,
  onGoScoreSection,
}: {
  student: ShareData['student']
  model: ShareModel
  onOpenWrongNote: (kind: 'reading' | 'vocab') => void
  onGoScoreSection: (id: string) => void
}) {
  const {
    classes, latestReport, scoredWeeks,
    readingRates, vocabRates, homeworkRates,
    attendance, clinicAttendance,
    totalAtt, presentAtt, totalClinicAtt, presentClinicAtt,
    commentFeed,
  } = model

  const className = latestReport?.className || classes[0]?.name || ''
  const hasAttendanceData = attendance.length > 0 || clinicAttendance.length > 0
  // 이번 주 코멘트는 리포트 카드가 보여주므로 기록에서는 뺀다
  const pastComments = commentFeed.filter((c) => c.week.id !== latestReport?.week.id)

  return (
    <>
      {/* 학생 헤더 — 카드 없이 텍스트만 */}
      <div className="px-1 pt-1">
        <p className={`text-[13px] ${MUTED}`}>
          {[student.grade, student.school, className].filter(Boolean).join(' · ') || '학습 리포트'}
        </p>
        <h1 className={`mt-0.5 text-[22px] font-bold tracking-tight ${INK}`}>{student.name}</h1>
      </div>

      {latestReport
        ? <WeeklyReportCard report={latestReport} onOpenWrongNote={onOpenWrongNote} />
        : <EmptyState>아직 시험 결과가 없어요.</EmptyState>}

      {scoredWeeks.length >= 2 && (
        <Card title="최근 흐름" subtitle={`${scoredWeeks.length}주 평균`}>
          <div className={`grid grid-cols-3 divide-x ${HAIRLINE.replace('border-', 'divide-')}`}>
            <TrendCell label="시험" rates={readingRates} onClick={() => onGoScoreSection('section-reading-chart')} />
            <TrendCell label="단어" rates={vocabRates} onClick={() => onGoScoreSection('section-vocab-chart')} />
            <TrendCell label="과제" rates={homeworkRates} onClick={() => onGoScoreSection('section-homework')} />
          </div>
        </Card>
      )}

      {hasAttendanceData && (
        <AttendanceSection
          attendance={attendance}
          clinicAttendance={clinicAttendance}
          summary={[
            totalAtt > 0 ? `정규수업 ${presentAtt}/${totalAtt}회` : null,
            totalClinicAtt > 0 ? `클리닉 ${presentClinicAtt}/${totalClinicAtt}회` : null,
          ].filter(Boolean).join(' · ')}
        />
      )}

      {pastComments.length > 0 && <CommentHistory comments={pastComments} />}
    </>
  )
}

// ── 이번 주 리포트 ──────────────────────────────────────────────────────────
function WeeklyReportCard({ report, onOpenWrongNote }: {
  report: WeeklyReport
  onOpenWrongNote: (kind: 'reading' | 'vocab') => void
}) {
  const { week, headline, memo, reading, vocab, homework, wrongReading, wrongVocab } = report
  const wrongTotal = wrongReading + wrongVocab

  return (
    <Card noPad>
      <div className="px-5 pt-5">
        <p className={`text-[12px] font-medium ${MUTED}`}>
          이번 주 · {getWeekLabel(week)}{week.start_date && ` · ${fmtShortDate(week.start_date)}`}
        </p>
        <p className={`mt-1.5 text-[17px] font-semibold leading-snug ${INK}`}>{headline}</p>
        {memo && (
          <blockquote className="mt-3 border-l-2 border-[#2463EB]/40 pl-3 dark:border-[#3B82F6]/50">
            <p className={`text-[14px] leading-relaxed ${BODY}`}>{memo}</p>
            <footer className={`mt-1 text-[12px] ${MUTED}`}>선생님 코멘트</footer>
          </blockquote>
        )}
      </div>

      <div className={`mt-4 divide-y border-t ${HAIRLINE} ${HAIRLINE.replace('border-', 'divide-')}`}>
        {reading && <MetricRow label="시험" metric={reading} onClick={wrongReading > 0 ? () => onOpenWrongNote('reading') : undefined} />}
        {vocab && <MetricRow label="단어" metric={vocab} onClick={wrongVocab > 0 ? () => onOpenWrongNote('vocab') : undefined} />}
        {homework && <MetricRow label="과제" metric={homework} />}
      </div>

      {wrongTotal > 0 && (
        <button
          type="button"
          onClick={() => onOpenWrongNote(wrongReading > 0 ? 'reading' : 'vocab')}
          className={`flex w-full items-center justify-between border-t px-5 py-3.5 text-[14px] font-semibold active:opacity-70 ${HAIRLINE} ${ACCENT}`}
        >
          <span>오답 {wrongTotal}문항 다시 보기</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </Card>
  )
}

/** 라벨 | 진행 막대 | 맞힌 수 · % | 지난주 대비 — 한 줄에 한 지표 */
function MetricRow({ label, metric, onClick }: { label: string; metric: WeeklyMetric; onClick?: () => void }) {
  const content = (
    <>
      <span className={`w-7 shrink-0 text-[13px] ${MUTED}`}>{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF0F3] dark:bg-white/[0.08]">
        <div className="h-full rounded-full bg-[#2463EB] dark:bg-[#3B82F6]" style={{ width: `${metric.rate}%` }} />
      </div>
      <span className={`w-[76px] shrink-0 text-right text-[14px] font-semibold tabular-nums ${INK}`}>
        {metric.correct}/{metric.total}
        <span className={`ml-1 text-[12px] font-medium ${MUTED}`}>{metric.rate}%</span>
      </span>
      <span className={`w-11 shrink-0 text-right text-[12px] tabular-nums ${MUTED}`}>
        {metric.delta !== null ? fmtDelta(metric.delta) : ''}
      </span>
    </>
  )
  const cls = 'flex w-full items-center gap-3 px-5 py-3 text-left'
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} active:opacity-70`}>{content}</button>
    : <div className={cls}>{content}</div>
}

// ── 최근 흐름 ───────────────────────────────────────────────────────────────
function TrendCell({ label, rates, onClick }: { label: string; rates: number[]; onClick: () => void }) {
  const mean = avg(rates)
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-start gap-1.5 px-3 py-1 text-left first:pl-0 last:pr-0 active:opacity-70">
      <span className={`text-[12px] ${MUTED}`}>{label}</span>
      <span className={`text-[17px] font-semibold tabular-nums ${INK}`}>{mean !== null ? `${mean}%` : '–'}</span>
      <Sparkline values={rates.slice(-8)} />
    </button>
  )
}

/** 64×20 폴리라인. 축·라벨 없음 — 방향만 보인다 */
function Sparkline({ values }: { values: number[] }) {
  const W = 64, H = 20
  if (values.length < 2) return <div className="h-5" />
  const pts = values.map((v, i) => [
    1 + (i / (values.length - 1)) * (W - 2),
    H - 1 - (Math.max(0, Math.min(100, v)) / 100) * (H - 2),
  ])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className={ACCENT}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2" fill="currentColor" />
    </svg>
  )
}

// ── 출결 ────────────────────────────────────────────────────────────────────
function AttendanceSection({ attendance, clinicAttendance, summary }: {
  attendance: ShareModel['attendance']
  clinicAttendance: ShareModel['clinicAttendance']
  summary: string
}) {
  const [view, setView] = useState<'regular' | 'clinic'>('regular')
  const both = attendance.length > 0 && clinicAttendance.length > 0
  const visible = view === 'clinic'
    ? (clinicAttendance.length > 0 ? 'clinic' : 'regular')
    : (attendance.length > 0 ? 'regular' : 'clinic')

  return (
    <Card id="section-attendance" title="출결" subtitle={summary}>
      {both && (
        <div className={`mb-3 flex gap-4 border-b ${HAIRLINE}`}>
          {([['regular', '정규수업'], ['clinic', '클리닉']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={visible === id}
              onClick={() => setView(id)}
              className={`-mb-px border-b-2 pb-2 text-[13px] font-semibold transition-colors ${
                visible === id ? `border-[#2463EB] dark:border-[#3B82F6] ${INK}` : `border-transparent ${MUTED}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <AttendanceCalendar attendance={visible === 'clinic' ? clinicAttendance : attendance} variant={visible} />
    </Card>
  )
}

// ── 선생님 코멘트 기록 ──────────────────────────────────────────────────────
function CommentHistory({ comments }: { comments: ShareModel['commentFeed'] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? comments : comments.slice(0, 2)
  return (
    <Card title="선생님 코멘트" subtitle="지난 주차 기록">
      <ul className={`divide-y ${HAIRLINE.replace('border-', 'divide-')}`}>
        {shown.map(({ week, memo, className }) => (
          <li key={week.id} className="py-3 first:pt-0 last:pb-0">
            <p className={`text-[12px] ${MUTED}`}>
              {[className, getWeekLabel(week)].filter(Boolean).join(' ')}
              {week.start_date && ` · ${fmtShortDate(week.start_date)}`}
            </p>
            <p className={`mt-1 text-[14px] leading-relaxed ${BODY}`}>{memo}</p>
          </li>
        ))}
      </ul>
      {comments.length > 2 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={`mt-3 flex items-center gap-1 text-[13px] font-semibold active:opacity-70 ${ACCENT}`}
        >
          {expanded
            ? <><ChevronUp className="h-3.5 w-3.5" /> 접기</>
            : <><ChevronDown className="h-3.5 w-3.5" /> 이전 코멘트 {comments.length - 2}개 더 보기</>}
        </button>
      )}
    </Card>
  )
}
