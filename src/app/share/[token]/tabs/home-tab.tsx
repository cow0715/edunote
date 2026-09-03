'use client'

// 홈 탭 — "이번 주 한 줄 → 코멘트 → 할 일 → 기간 요약".
//
// design_handoff_share_report/README.md "1. 홈" 이 원본이다.
//   · 대시보드가 아니다. 카드 4장뿐이고 순서가 곧 정보 위계다.
//   · 카테고리(시험/단어/과제)를 색으로 구분하지 않는다. 파랑=액션/긍정, 빨강=주의.
//   · 스탯 카드 격자·히어로 숫자·이모지 칩·과제 바차트는 전부 이 구조로 대체됐다.

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, EmptyState } from '../share-components'
import { SummaryChart } from '../summary-chart'
import { CountUp } from '../share-ui'
import { ATT_DOT, ATT_LABEL_KO, PRESS, PRESS_ROW, T, deltaColor, riseStyle } from '../share-tokens'
import { PeriodMetric, ShareModel, WeeklyReport } from '../use-share-model'
import { fmtCount, fmtDelta, fmtShortDate, getWeekLabel } from '../share-utils'

type ChartMetric = 'reading' | 'vocab' | 'homework'

export function HomeTab({
  model,
  periodLabel,
  onOpenWrongNote,
  onGoHistoryWeek,
  onGoHistory,
}: {
  model: ShareModel
  periodLabel: string
  onOpenWrongNote: (kind: 'reading' | 'vocab') => void
  onGoHistoryWeek: (weekId: string) => void
  onGoHistory: () => void
}) {
  const { latestReport, periodSummary, commentFeed, attendanceStreak, attendance } = model

  // 이번 주 코멘트는 코멘트 카드가 본문으로 보여주므로 "이전 코멘트" 에서는 뺀다
  const olderComments = commentFeed.filter((c) => c.week.id !== latestReport?.week.id)

  if (!latestReport) return <EmptyState>아직 기록이 없어요.</EmptyState>

  return (
    <>
      <ThisWeekCard report={latestReport} periodLabel={periodLabel} />

      {latestReport.memo && (
        <CommentCard
          memo={latestReport.memo}
          date={latestReport.week.start_date}
          older={olderComments}
        />
      )}

      <TodoCard report={latestReport} onOpenWrongNote={onOpenWrongNote} />

      <PeriodSummaryCard
        summary={periodSummary}
        periodLabel={periodLabel}
        attendanceStreak={attendanceStreak}
        absentCount={attendance.filter((a) => a.status !== 'present').length}
        onGoHistoryWeek={onGoHistoryWeek}
        onGoHistory={onGoHistory}
      />
    </>
  )
}

// ── ① 이번 주 카드 ─────────────────────────────────────────────────────────
function ThisWeekCard({ report, periodLabel }: { report: WeeklyReport; periodLabel: string }) {
  const { week, headline, facts, attendanceStatus } = report
  // display_label 은 기간명을 이미 품고 있는 경우가 많다 ("기존 9주차").
  // 앞에 기간명을 또 붙이면 "기존 기존 9주차" 가 된다.
  const weekLabel = getWeekLabel(week)
  const eyebrowLabel = weekLabel.includes(periodLabel) ? weekLabel : `${periodLabel} ${weekLabel}`
  return (
    <div className="rounded-[20px] bg-[#F9FAFB] px-[22px] pt-[22px] pb-5" style={riseStyle(0)}>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[11px] font-bold tracking-[0.08em] text-[#3182F6]">
          이번 주 · {eyebrowLabel}
          {week.start_date && ` · ${fmtShortDate(week.start_date)}`}
        </span>
        {attendanceStatus && (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[#8B95A1]">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: ATT_DOT[attendanceStatus] }} />
            {ATT_LABEL_KO[attendanceStatus]}
          </span>
        )}
      </div>

      <p className="mb-4 text-[23px] font-bold leading-[1.32] tracking-[-0.025em] text-pretty">{headline}</p>

      <div className="flex flex-col gap-2">
        {facts.map((f, i) => (
          <div key={i} className="flex items-center gap-2.5 text-[13px] leading-[1.4]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: f.warn ? T.red : T.disabled }}
            />
            <span className="text-[#4E5968] tabular-nums">{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── ② 선생님 코멘트 카드 ────────────────────────────────────────────────────
function CommentCard({ memo, date, older }: {
  memo: string
  date: string | null
  older: ShareModel['commentFeed']
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-[20px] bg-[#F9FAFB] px-[22px] py-5" style={riseStyle(1)}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.08em] text-[#8B95A1]">선생님 코멘트</span>
        {date && <span className="text-[11px] text-[#8B95A1]">{fmtShortDate(date)}</span>}
      </div>
      <p className="text-[15px] font-medium leading-[1.6] text-[#333D4B]">{memo}</p>

      {older.length > 0 && (
        open ? (
          <div className="mt-3.5 flex flex-col gap-3 border-t border-[#E5E8EB] pt-3.5">
            {older.map(({ week, memo: text }) => (
              <div key={week.id}>
                <p className="text-[11px] text-[#8B95A1]">
                  {getWeekLabel(week)}{week.start_date && ` · ${fmtShortDate(week.start_date)}`}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#4E5968]">{text}</p>
              </div>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`${PRESS} mt-3 text-[13px] font-bold text-[#3182F6]`}
          >
            이전 코멘트 {older.length}개
          </button>
        )
      )}
    </div>
  )
}

// ── ③ 할 일 리스트 카드 ────────────────────────────────────────────────────
function TodoCard({ report, onOpenWrongNote }: {
  report: WeeklyReport
  onOpenWrongNote: (kind: 'reading' | 'vocab') => void
}) {
  const { wrongReading, wrongVocab, retakeTaken, retakePending } = report
  if (wrongReading === 0 && wrongVocab === 0) return null

  const retakeDone = wrongVocab - retakePending
  return (
    <Card noPad riseIndex={2}>
      <div className="flex flex-col py-1">
        {wrongReading > 0 && (
          <TodoRow
            title={`진단평가 오답 ${wrongReading}문항`}
            hint="해설 보고 다시 풀기"
            action="풀기"
            onClick={() => onOpenWrongNote('reading')}
          />
        )}
        {wrongVocab > 0 && (
          <TodoRow
            title={`단어 오답 ${wrongVocab}개`}
            hint={retakeTaken ? `재시험 ${retakeDone}/${wrongVocab} 통과` : '재시험 아직 안 봄'}
            action="재시험"
            onClick={() => onOpenWrongNote('vocab')}
          />
        )}
      </div>
    </Card>
  )
}

function TodoRow({ title, hint, action, onClick }: {
  title: string; hint: string; action: string; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className={`${PRESS_ROW} flex items-center gap-3 px-[22px] py-3.5 text-left`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">{title}</span>
        <span className="mt-0.5 block text-[12px] text-[#8B95A1]">{hint}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-bold text-[#3182F6]">
        {action}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}

// ── ④ 기간 요약 카드 ───────────────────────────────────────────────────────
const METRIC_LABEL: Record<ChartMetric, string> = { reading: '시험', vocab: '단어', homework: '과제' }
const CHART_CAPTION: Record<ChartMetric, string> = {
  reading: '시험 정답률 (%) · 점선은 반 평균',
  vocab: '단어 정답률 (%) · 점선은 반 평균',
  homework: '과제 제출률 (%)',
}

function PeriodSummaryCard({
  summary, periodLabel, attendanceStreak, absentCount, onGoHistoryWeek, onGoHistory,
}: {
  summary: ShareModel['periodSummary']
  periodLabel: string
  attendanceStreak: number
  absentCount: number
  onGoHistoryWeek: (weekId: string) => void
  onGoHistory: () => void
}) {
  const available = (['reading', 'vocab', 'homework'] as const).filter((k) => summary[k])
  // 데이터가 있는 첫 항목으로 폴백한다 — 시험 없는 기간에 '시험' 시리즈를 고를 수 없다
  const [picked, setPicked] = useState<ChartMetric>('reading')
  const metric: ChartMetric | null = available.includes(picked) ? picked : available[0] ?? null
  const selected = metric ? summary[metric] : null

  if (available.length === 0) return null

  return (
    <Card title={`${periodLabel} 요약`} aside={`${summary.weekCount}회차`} noPad riseIndex={3}>
      <div className="flex flex-col pb-1">
        {available.map((key) => (
          <SummaryRow
            key={key}
            label={METRIC_LABEL[key]}
            metric={summary[key]!}
            selected={metric === key}
            onClick={() => setPicked(key)}
          />
        ))}
        <AttendanceRow streak={attendanceStreak} absentCount={absentCount} onClick={onGoHistory} />
      </div>

      {selected && (
        <div className="border-t border-[#EEF1F4] px-[22px] pt-4 pb-5">
          {selected.points.length >= 2 ? (
            <SummaryChart
              // 시리즈가 바뀌면 draw 모션을 처음부터 다시 재생시킨다
              key={metric ?? 'none'}
              points={selected.points}
              caption={CHART_CAPTION[metric!]}
              onSelectWeek={onGoHistoryWeek}
            />
          ) : (
            <p className="text-[12px] text-[#8B95A1]">
              {periodLabel}은 아직 1회차예요. 2회차부터 추이가 보입니다.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function SummaryRow({ label, metric, selected, onClick }: {
  label: string; metric: PeriodMetric; selected: boolean; onClick: () => void
}) {
  const delta = [
    metric.delta !== null ? fmtDelta(metric.delta) : null,
    metric.classDiff !== null ? `반 평균 ${metric.classDiff > 0 ? '+' : ''}${metric.classDiff}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`${PRESS} flex items-center gap-3 px-[22px] py-3 text-left transition-colors`}
      style={{ background: selected ? T.box : undefined }}
    >
      <span
        className="w-16 shrink-0 text-[13px] font-bold"
        style={{ color: selected ? T.blue : T.body2 }}
      >
        {label}
      </span>
      <span className="flex-1 tabular-nums">
        <span className="text-[20px] font-bold">
          <CountUp value={metric.mean} />
        </span>
        <span className="ml-0.5 text-[12px] text-[#8B95A1]">%</span>
      </span>
      <span
        className="shrink-0 text-[12px] font-semibold tabular-nums"
        style={{ color: deltaColor(metric.delta) }}
      >
        {delta}
      </span>
      {!selected && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#B0B8C1]" />}
    </button>
  )
}

function AttendanceRow({ streak, absentCount, onClick }: {
  streak: number; absentCount: number; onClick: () => void
}) {
  const warn = absentCount > 0
  return (
    <button type="button" onClick={onClick} className={`${PRESS} flex items-center gap-3 px-[22px] py-3 text-left`}>
      <span className="w-16 shrink-0 text-[13px] font-bold text-[#4E5968]">출석</span>
      <span className="flex-1 tabular-nums">
        <span className="text-[20px] font-bold">{fmtCount(streak)}</span>
        <span className="ml-0.5 text-[12px] text-[#8B95A1]">회 연속</span>
      </span>
      <span
        className="shrink-0 text-[12px] font-semibold tabular-nums"
        style={{ color: warn ? T.red : T.muted2 }}
      >
        {warn ? `지각·결석 ${absentCount}회` : '전부 출석'}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#B0B8C1]" />
    </button>
  )
}
