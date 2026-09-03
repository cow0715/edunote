'use client'

// 기록 탭 — "회차별 기록".
//
// design_handoff_share_report/README.md "2. 기록" 이 원본이다.
// 홈에 있던 추이 그래프는 홈 요약 카드로 옮겨갔고, 여기는 회차 아코디언 + 출결만 남는다.
//   · 기간 그룹 헤더 → 회차 아코디언(기본 펼침은 최신 회차 하나).
//   · 이 탭만 "이 기간 / 전체 기간" 스코프를 오간다 (scope=all 로 따로 받아온다).

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AttendanceCalendar, Card, EmptyState } from '../share-components'
import { AccordionRow, Chip, Segmented } from '../share-ui'
import { ATT_BADGE, ATT_LABEL } from '../share-utils'
import { PRESS_STRONG, T } from '../share-tokens'
import { HistoryChip, HistoryGroup, HistoryRow, buildHistoryGroups } from '../history-utils'
import { ShareData } from '../share-types'
import { ShareModel } from '../use-share-model'

type HistScope = 'period' | 'all'

export function ScoreTab({
  token,
  model,
  periodLabel,
  selectedPeriodId,
  hasOtherPeriods,
  onOpenWrongNoteWeek,
}: {
  token: string
  model: ShareModel
  periodLabel: string
  selectedPeriodId: string | null
  /** 기간이 하나뿐이면 스코프 세그먼트를 숨긴다 */
  hasOtherPeriods: boolean
  onOpenWrongNoteWeek: (kind: 'reading' | 'vocab', weekId: string) => void
}) {
  const [scope, setScope] = useState<HistScope>('period')

  // 전체 기간은 기간 필터를 걷은 별도 응답이 필요하다. 토글하기 전에는 받지 않는다.
  const allScopeQuery = useQuery<ShareData>({
    queryKey: ['share-history-all', token, selectedPeriodId],
    queryFn: async () => {
      const period = selectedPeriodId ? `periodId=${encodeURIComponent(selectedPeriodId)}&` : ''
      const res = await fetch(`/api/share/${token}?${period}scope=all`)
      if (!res.ok) throw new Error('기록을 불러올 수 없습니다')
      return res.json()
    },
    enabled: scope === 'all' && hasOtherPeriods,
    retry: false,
  })

  const groups = buildHistoryGroups(
    scope === 'all' && allScopeQuery.data ? allScopeQuery.data : model
  )

  const weekCount = groups.reduce((sum, g) => sum + g.rows.length, 0)
  const latestWeekId = groups[0]?.rows[0]?.week.id ?? null

  return (
    <>
      <div className="flex items-end justify-between gap-3 px-1.5 pt-1">
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">회차별 기록</h1>
          <p className="mt-0.5 text-[13px] text-[#8B95A1]">
            {scope === 'all' ? '전체 기간' : periodLabel} {weekCount}회차
          </p>
        </div>
        {hasOtherPeriods && (
          <Segmented
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'period', label: periodLabel },
              { value: 'all', label: '전체 기간' },
            ]}
          />
        )}
      </div>

      {scope === 'all' && allScopeQuery.isLoading && (
        <EmptyState>전체 기간 기록을 불러오는 중이에요.</EmptyState>
      )}
      {scope === 'all' && allScopeQuery.isError && (
        <EmptyState>전체 기간 기록을 불러오지 못했어요.</EmptyState>
      )}

      {weekCount === 0
        ? <EmptyState>아직 기록된 회차가 없어요.</EmptyState>
        : groups.map((group) => (
          <HistoryGroupCard
            key={group.periodId}
            group={group}
            latestWeekId={latestWeekId}
            showPeriodHeader={scope === 'all'}
            onOpenWrongNoteWeek={onOpenWrongNoteWeek}
          />
        ))}

      <AttendanceSection model={model} />
    </>
  )
}

// ── 기간 그룹 ──────────────────────────────────────────────────────────────
function HistoryGroupCard({ group, latestWeekId, showPeriodHeader, onOpenWrongNoteWeek }: {
  group: HistoryGroup
  latestWeekId: string | null
  showPeriodHeader: boolean
  onOpenWrongNoteWeek: (kind: 'reading' | 'vocab', weekId: string) => void
}) {
  // 기본 펼침은 최신 회차 하나뿐 — 전부 펼치면 스크롤이 감당 안 된다
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(latestWeekId && group.rows.some((r) => r.week.id === latestWeekId) ? [latestWeekId] : [])
  )
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="flex flex-col gap-2">
      {showPeriodHeader && (
        <div className="flex items-baseline gap-2 px-1.5">
          <span className="text-[13px] font-extrabold text-[#3182F6]">{group.periodLabel}</span>
          <span className="text-[11px] text-[#8B95A1]">{group.rows.length}회차</span>
        </div>
      )}
      <Card noPad>
        <div className="divide-y divide-[#EEF1F4]">
          {group.rows.map((row) => (
            <HistoryRowView
              key={row.week.id}
              row={row}
              open={expanded.has(row.week.id)}
              onToggle={() => toggle(row.week.id)}
              onOpenWrongNoteWeek={onOpenWrongNoteWeek}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

// ── 회차 행 ────────────────────────────────────────────────────────────────
function HistoryRowView({ row, open, onToggle, onOpenWrongNoteWeek }: {
  row: HistoryRow
  open: boolean
  onToggle: () => void
  onOpenWrongNoteWeek: (kind: 'reading' | 'vocab', weekId: string) => void
}) {
  const badge = row.attendance ? ATT_BADGE[row.attendance] : null
  const hasDetail = row.wrongTypes.length > 0 || row.memo || row.wrongReading > 0 || row.wrongVocab > 0

  return (
    <AccordionRow
      id={`history-${row.week.id}`}
      open={open}
      onToggle={onToggle}
      header={
        <>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-extrabold">{row.weekLabel}</span>
            {row.dateLabel && <span className="text-[12px] text-[#8B95A1]">{row.dateLabel}</span>}
            {badge && row.attendance && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ color: badge.color, background: badge.bg }}
              >
                {ATT_LABEL[row.attendance]}
              </span>
            )}
          </span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            {row.chips.map((c) => <ScoreChip key={c.label} chip={c} />)}
          </span>
        </>
      }
    >
      {hasDetail ? (
        <div className="flex flex-col gap-3">
          {row.wrongTypes.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-bold text-[#8B95A1]">이번 회차 오답 유형</p>
              <div className="flex flex-wrap gap-1.5">
                {row.wrongTypes.map((t) => (
                  <Chip key={t.name} tone="red">{t.name} {t.count}</Chip>
                ))}
              </div>
            </div>
          )}

          {row.memo && (
            <div className="rounded-[12px] bg-white px-3.5 py-3">
              <p className="text-[10px] font-bold text-[#3182F6]">선생님 코멘트</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[#333D4B]">{row.memo}</p>
            </div>
          )}

          {(row.wrongReading > 0 || row.wrongVocab > 0) && (
            <div className="flex gap-2">
              {row.wrongReading > 0 && (
                <ActionButton
                  primary
                  label={`오답 ${row.wrongReading}문항 보기`}
                  onClick={() => onOpenWrongNoteWeek('reading', row.week.id)}
                />
              )}
              {row.wrongVocab > 0 && (
                <ActionButton
                  label={`틀린 단어 ${row.wrongVocab}개`}
                  onClick={() => onOpenWrongNoteWeek('vocab', row.week.id)}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-[#8B95A1]">이 회차엔 오답·코멘트가 없어요.</p>
      )}
    </AccordionRow>
  )
}

function ScoreChip({ chip }: { chip: HistoryChip }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[10px] bg-white px-2 py-1 text-[11px]">
      <span className="text-[#6B7684]">{chip.label}</span>
      <strong className="font-extrabold tabular-nums" style={{ color: chip.warn ? T.red : T.ink }}>
        {chip.value}
      </strong>
      {chip.classDiff !== null && (
        <span
          className="text-[10px] font-bold tabular-nums"
          style={{ color: chip.classDiff >= 0 ? T.blue : T.red }}
        >
          반 {chip.classDiff > 0 ? '+' : ''}{chip.classDiff}%
        </span>
      )}
    </span>
  )
}

function ActionButton({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${PRESS_STRONG} flex-1 rounded-[14px] py-2.5 text-[13px] font-bold`}
      style={primary
        ? { background: T.blue, color: '#FFFFFF' }
        : { background: '#FFFFFF', color: T.body2 }}
    >
      {label}
    </button>
  )
}

// ── 출결 현황 ──────────────────────────────────────────────────────────────
function AttendanceSection({ model }: { model: ShareModel }) {
  const {
    attendance, clinicAttendance,
    totalAtt, presentAtt, totalClinicAtt, presentClinicAtt,
  } = model
  const [view, setView] = useState<'regular' | 'clinic'>('regular')

  if (attendance.length === 0 && clinicAttendance.length === 0) return null
  const both = attendance.length > 0 && clinicAttendance.length > 0
  const visible: 'regular' | 'clinic' = both
    ? view
    : attendance.length > 0 ? 'regular' : 'clinic'

  return (
    <Card
      title="출결 현황"
      aside={both ? undefined : visible === 'clinic' ? '클리닉' : '정규수업'}
    >
      {both && (
        <div className="mb-4">
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[{ value: 'regular', label: '정규수업' }, { value: 'clinic', label: '클리닉' }]}
          />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2">
        <AttSummary label="정규수업" present={presentAtt} total={totalAtt} accent />
        <AttSummary label="클리닉" present={presentClinicAtt} total={totalClinicAtt} />
      </div>

      <AttendanceCalendar
        attendance={visible === 'clinic' ? clinicAttendance : attendance}
        variant={visible}
      />
    </Card>
  )
}

function AttSummary({ label, present, total, accent }: {
  label: string; present: number; total: number; accent?: boolean
}) {
  return (
    <div className="rounded-[14px] bg-white px-3.5 py-3">
      <p className="text-[11px] font-bold text-[#8B95A1]">{label}</p>
      {total > 0 ? (
        <p className="mt-0.5 tabular-nums">
          <span className="text-[22px] font-black" style={{ color: accent ? T.blue : T.ink }}>{present}</span>
          <span className="text-[12px] font-bold text-[#8B95A1]">/{total}회</span>
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] text-[#B0B8C1]">기록 없음</p>
      )}
    </div>
  )
}
