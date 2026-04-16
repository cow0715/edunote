'use client'

import { Award, Minus, Square, BookOpen, BookText, ClipboardCheck } from 'lucide-react'
import type { ReportCard, ReportMetrics, PeriodComparison, ClassContext, AcademyProfile, WeekRow, WrongItem } from '@/lib/report-card'
import { qualitativeLabel, qualitativeColor } from '@/lib/report-card'

interface Props {
  student: { id: string; name: string; school: string | null; grade: string | null; student_code: string | null }
  card: ReportCard
  metrics: ReportMetrics
  previous: PeriodComparison | null
  academy: AcademyProfile
  classContext: ClassContext | null
}

const BLUE = '#2463EB'
const GREEN = '#10B981'
const ORANGE = '#F97316'
const RED = '#EF4444'

function reportNumber(cardId: string, generatedAt: string): string {
  const d = new Date(generatedAt)
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `RC-${yymmdd}-${cardId.slice(0, 6).toUpperCase()}`
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const nums = values.map((v) => (v === null ? null : Math.max(0, Math.min(100, v))))
  const valid = nums.filter((v): v is number => v !== null)
  if (valid.length < 1) return <span className="text-[10px] text-gray-300">—</span>
  const w = 56, h = 16
  const n = nums.length
  const step = n > 1 ? w / (n - 1) : 0
  const points: { x: number; y: number }[] = []
  nums.forEach((v, i) => {
    if (v === null) return
    const x = n > 1 ? i * step : w / 2
    const y = h - (v / 100) * (h - 2) - 1
    points.push({ x, y })
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const first = points[0]
  const trending = last && first ? last.y < first.y : null // y가 작을수록 점수 높음
  const lineColor = trending === true ? GREEN : trending === false ? RED : BLUE
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none">
      {points.length > 1 && <path d={path} fill="none" stroke={lineColor} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.2" fill={lineColor} />)}
    </svg>
  )
}

function WeeklyChart({ rows, classAvgReading, classAvgVocab, classAvgHomework }: {
  rows: WeekRow[]
  classAvgReading?: number | null
  classAvgVocab?: number | null
  classAvgHomework?: number | null
}) {
  if (rows.length === 0) return null
  const W = 480, H = 80, PAD_L = 28, PAD_R = 8, PAD_T = 6, PAD_B = 18
  const cW = W - PAD_L - PAD_R
  const cH = H - PAD_T - PAD_B
  const n = rows.length
  const xOf = (i: number) => PAD_L + (n === 1 ? cW / 2 : (i / (n - 1)) * cW)
  const yOf = (v: number) => PAD_T + cH - (Math.max(0, Math.min(100, v)) / 100) * cH
  const linePath = (vals: (number | null)[]) => {
    const pts = vals.map((v, i) => v === null ? null : { x: xOf(i), y: yOf(v) }).filter((p): p is { x: number; y: number } => p !== null)
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  }
  const avgLine = (val: number | null | undefined, color: string) => {
    if (val === null || val === undefined) return null
    const y = yOf(val).toFixed(1)
    return <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={color} strokeWidth="0.8" strokeDasharray="3,2" opacity="0.5" />
  }
  const COLORS = { r: BLUE, v: GREEN, h: '#F59E0B' }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={PAD_L} y1={yOf(v)} x2={W - PAD_R} y2={yOf(v)} stroke="#E5E7EB" strokeWidth="0.5" />
          <text x={PAD_L - 3} y={yOf(v) + 3} fontSize="6" fill="#9CA3AF" textAnchor="end">{v}</text>
        </g>
      ))}
      {avgLine(classAvgReading, COLORS.r)}
      {avgLine(classAvgVocab, COLORS.v)}
      {avgLine(classAvgHomework, COLORS.h)}
      <path d={linePath(rows.map(r => r.reading_rate))} fill="none" stroke={COLORS.r} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={linePath(rows.map(r => r.vocab_rate))} fill="none" stroke={COLORS.v} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={linePath(rows.map(r => r.homework_rate))} fill="none" stroke={COLORS.h} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {rows.map((row, i) => (
        <g key={row.week_id}>
          {row.reading_rate !== null && <circle cx={xOf(i)} cy={yOf(row.reading_rate)} r="2" fill={COLORS.r} />}
          {row.vocab_rate !== null && <circle cx={xOf(i)} cy={yOf(row.vocab_rate)} r="2" fill={COLORS.v} />}
          {row.homework_rate !== null && <circle cx={xOf(i)} cy={yOf(row.homework_rate)} r="2" fill={COLORS.h} />}
          <text x={xOf(i)} y={H - 3} fontSize="6" fill="#9CA3AF" textAnchor="middle">{row.week_number}주</text>
        </g>
      ))}
      {[['독해', COLORS.r], ['어휘', COLORS.v], ['과제', COLORS.h]].map(([label, color], i) => (
        <g key={label} transform={`translate(${PAD_L + i * 44},${PAD_T - 2})`}>
          <line x1="0" y1="3" x2="8" y2="3" stroke={color} strokeWidth="1.5" />
          <text x="10" y="6" fontSize="6.5" fill={color as string}>{label}</text>
        </g>
      ))}
    </svg>
  )
}

function RadarChart({ axes, classAvg }: {
  axes: { label: string; value: number | null; classValue?: number | null }[]
  classAvg?: boolean
}) {
  const SIZE = 120, cx = 60, cy = 60, R = 44
  const n = axes.length
  const angleOf = (i: number) => (2 * Math.PI * i / n) - Math.PI / 2
  const ptOf = (i: number, val: number) => {
    const a = angleOf(i), r = R * Math.max(0, Math.min(100, val)) / 100
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }
  const labelPtOf = (i: number) => {
    const a = angleOf(i)
    return { x: cx + (R + 14) * Math.cos(a), y: cy + (R + 14) * Math.sin(a) }
  }
  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z'
  const studentPoly = axes.map((ax, i) => ptOf(i, ax.value ?? 0))
  const classPoly = axes.map((ax, i) => ptOf(i, ax.classValue ?? 0))
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} style={{ display: 'block', margin: '0 auto' }}>
      {[25, 50, 75, 100].map((lv) => (
        <path key={lv} d={toPath(axes.map((_, i) => ptOf(i, lv)))} fill="none" stroke="#E5E7EB" strokeWidth="0.5" />
      ))}
      {axes.map((_, i) => {
        const p = ptOf(i, 100)
        return <line key={i} x1={cx} y1={cy} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke="#E5E7EB" strokeWidth="0.5" />
      })}
      {classAvg && axes.some((ax) => ax.classValue != null) && (
        <path d={toPath(classPoly)} fill="#94A3B8" fillOpacity="0.12" stroke="#94A3B8" strokeWidth="1" />
      )}
      <path d={toPath(studentPoly)} fill={BLUE} fillOpacity="0.15" stroke={BLUE} strokeWidth="1.5" />
      {studentPoly.map((p, i) => axes[i].value !== null && <circle key={i} cx={p.x} cy={p.y} r="2" fill={BLUE} />)}
      {axes.map((ax, i) => {
        const lp = labelPtOf(i)
        return <text key={i} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)} fontSize="7" fill="#374151" textAnchor="middle" dominantBaseline="middle">{ax.label}</text>
      })}
      <text x={cx} y={cy + R * 0.5 + 2} fontSize="5.5" fill="#D1D5DB" textAnchor="middle">50</text>
    </svg>
  )
}

function PrevCompareBar({ label, current, previous, color }: {
  label: string; current: number | null; previous: number | null; color: string
}) {
  if (current === null) return null
  const delta = previous !== null ? current - previous : null
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-gray-500">{label}</span>
        <div className="flex items-center gap-1">
          {delta !== null && (
            <span className="text-[10px] font-semibold" style={{ color: delta >= 0 ? GREEN : RED }}>
              {delta >= 0 ? '▲' : '▼'}{Math.abs(delta)}%
            </span>
          )}
          <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{current}%</span>
        </div>
      </div>
      <div className="relative h-1.5 rounded-full bg-gray-100">
        {previous !== null && (
          <div className="absolute left-0 top-0 h-full rounded-full bg-gray-300"
            style={{ width: `${Math.max(0, Math.min(100, previous))}%` }} />
        )}
        <div className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, current))}%`, background: color }} />
      </div>
      {previous !== null && <p className="text-[9px] text-gray-400 mt-0.5">이전 {previous}%</p>}
    </div>
  )
}

function DomainCard({ icon: Icon, title, rate, classAvg, prevRate, series }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  rate: number | null
  classAvg: number | null | undefined
  prevRate?: number | null
  series: (number | null)[]
}) {
  const diff = rate !== null && classAvg != null ? rate - classAvg : null
  const isWeak = rate !== null && ((diff !== null && diff < -5) || rate < 65)
  const barColor = isWeak ? ORANGE : qualitativeColor(rate)
  const prevDelta = rate !== null && prevRate != null ? rate - prevRate : null

  return (
    <div className={`rounded-xl border p-3 ${isWeak ? 'border-orange-200 bg-orange-50/20' : 'border-gray-100'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 ${isWeak ? 'text-orange-400' : 'text-gray-400'}`} />
          <span className="text-xs font-semibold text-gray-800">{title}</span>
        </div>
        {isWeak && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600">보완 필요</span>
        )}
      </div>
      <div className="flex items-end gap-2 mb-2">
        <span className="text-2xl font-extrabold tabular-nums leading-none" style={{ color: barColor }}>
          {rate ?? '-'}
        </span>
        {rate !== null && <span className="text-xs text-gray-400 mb-0.5">%</span>}
        {prevDelta !== null && (
          <span className="text-xs font-semibold mb-0.5" style={{ color: prevDelta >= 0 ? GREEN : RED }}>
            {prevDelta >= 0 ? '▲' : '▼'}{Math.abs(prevDelta)}
          </span>
        )}
        <div className="flex-1" />
        <Sparkline values={series} />
      </div>
      <div className="relative h-1.5 rounded-full bg-gray-100 mb-1.5">
        <div className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, rate ?? 0))}%`, background: barColor }} />
        {classAvg != null && (
          <div className="absolute top-[-3px] bottom-[-3px] w-px bg-gray-500"
            style={{ left: `${Math.max(0, Math.min(100, classAvg))}%` }} />
        )}
      </div>
      {classAvg != null ? (
        <p className="text-[10px] text-gray-400">
          반 평균 {classAvg}%
          {diff !== null && (
            <span className="font-semibold ml-1" style={{ color: diff >= 0 ? GREEN : RED }}>
              {diff >= 0 ? `+${diff}` : diff}
            </span>
          )}
        </p>
      ) : (
        <p className="text-[10px] text-gray-400">{qualitativeLabel(rate)}</p>
      )}
    </div>
  )
}

export function ReportCardPreview({ student, card, metrics, previous, academy, classContext }: Props) {
  const {
    weekRows, avgReading, avgVocab, avgHomework, overallAvg,
    attendancePresent, attendanceLate, attendanceAbsent, attendanceTotal,
    strengths, weaknesses, categoryStats, totalQuestions, totalCorrect, achievements,
    wrongItems,
  } = metrics

  const readingSeries = weekRows.map((r: WeekRow) => r.reading_rate)
  const vocabSeries = weekRows.map((r: WeekRow) => r.vocab_rate)
  const homeworkSeries = weekRows.map((r: WeekRow) => r.homework_rate)

  const attendedCount = attendancePresent + attendanceLate
  const attendRate = attendanceTotal > 0 ? Math.round((attendedCount / attendanceTotal) * 100) : null
  const className = weekRows[0]?.class_name ?? '-'
  const focusItems = (card.next_focus ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  const periodEvalLabel = card.period_type === 'monthly' ? '월간 평가'
    : card.period_type === 'quarterly' ? '분기 평가' : '학기 평가'

  const overallDelta = overallAvg !== null && previous?.overallAvg != null ? overallAvg - previous.overallAvg : null
  const vsClassAvg = overallAvg !== null && classContext?.classAvgOverall != null
    ? overallAvg - classContext.classAvgOverall : null

  return (
    <div
      className="mx-auto bg-white text-gray-900"
      style={{
        fontFamily: "'Plus Jakarta Sans', 'Pretendard', system-ui, sans-serif",
        maxWidth: '210mm',
        minHeight: '297mm',
        padding: '28px',
      }}
    >
      {/* ── 히어로 헤더 ─────────────────────────────────────── */}
      <header className="pb-5 border-b-2 border-gray-900">
        <div className="flex items-start justify-between gap-4">
          {/* 왼쪽: 학생 정보 */}
          <div>
            <p className="text-[10px] text-gray-400 mb-0.5">{academy.name ?? ''} · {periodEvalLabel}</p>
            <h1 className="text-3xl font-extrabold tracking-tight leading-none">{student.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-xs text-gray-500">{className}</span>
              {academy.teacher_name && (
                <>
                  <span className="text-gray-200">·</span>
                  <span className="text-xs text-gray-500">담당 {academy.teacher_name}</span>
                </>
              )}
              {[student.school, student.grade].filter(Boolean).length > 0 && (
                <>
                  <span className="text-gray-200">·</span>
                  <span className="text-xs text-gray-500">{[student.school, student.grade].filter(Boolean).join(' ')}</span>
                </>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              {card.period_label} · 발급 {new Date(card.generated_at).toLocaleDateString('ko-KR')} · {reportNumber(card.id, card.generated_at)}
            </p>
          </div>

          {/* 오른쪽: 종합 점수 + 석차 */}
          <div className="text-right shrink-0">
            <div className="flex items-end justify-end gap-2">
              <span className="text-5xl font-extrabold tabular-nums leading-none" style={{ color: BLUE }}>
                {overallAvg ?? '-'}
              </span>
              <div className="mb-1">
                <span className="text-sm text-gray-400">/100</span>
                {overallDelta !== null && (
                  <p className="text-xs font-semibold" style={{ color: overallDelta >= 0 ? GREEN : RED }}>
                    {overallDelta >= 0 ? '▲' : '▼'}{Math.abs(overallDelta)}점
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-2 flex-wrap">
              {classContext?.classRank && (
                <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-1 rounded-full"
                  style={{ background: '#EBF3FF', color: BLUE }}>
                  반 {classContext.classRank}위/{classContext.classTotalStudents}명
                </span>
              )}
              {classContext?.classPercentile && (
                <span className="text-[10px] text-gray-400">상위 {classContext.classPercentile}%</span>
              )}
              {card.overall_grade && (
                <span className="inline-flex items-center text-[11px] font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                  {card.overall_grade}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── 요약 카드 3개 ─────────────────────────────────────── */}
      <section className="mt-4 grid grid-cols-3 gap-3">
        {/* 전기간 대비 */}
        <div className="rounded-xl bg-gray-50 px-4 py-3">
          <p className="text-[10px] text-gray-400">전 기간 대비</p>
          {overallDelta !== null ? (
            <>
              <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: overallDelta >= 0 ? GREEN : RED }}>
                {overallDelta >= 0 ? '+' : ''}{overallDelta}
                <span className="text-sm font-medium text-gray-400">점</span>
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                이전 {previous?.overallAvg}% → 현재 {overallAvg}%
              </p>
            </>
          ) : (
            <p className="mt-1 text-lg font-bold text-gray-300">—</p>
          )}
        </div>

        {/* 반 평균 대비 */}
        <div className="rounded-xl bg-gray-50 px-4 py-3">
          <p className="text-[10px] text-gray-400">반 평균 대비</p>
          {vsClassAvg !== null ? (
            <>
              <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: vsClassAvg >= 0 ? GREEN : ORANGE }}>
                {vsClassAvg >= 0 ? '+' : ''}{vsClassAvg}
                <span className="text-sm font-medium text-gray-400">점</span>
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                반 평균 {classContext?.classAvgOverall}%
              </p>
            </>
          ) : (
            <p className="mt-1 text-lg font-bold text-gray-300">—</p>
          )}
        </div>

        {/* 출석 */}
        <div className="rounded-xl bg-gray-50 px-4 py-3">
          <p className="text-[10px] text-gray-400">출석률</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: attendRate !== null && attendRate >= 90 ? GREEN : attendRate !== null && attendRate < 80 ? ORANGE : BLUE }}>
            {attendRate ?? '-'}<span className="text-sm font-medium text-gray-400">%</span>
          </p>
          {attendanceTotal > 0 && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              출석 {attendancePresent} · 지각 {attendanceLate} · 결석 {attendanceAbsent}
            </p>
          )}
        </div>
      </section>

      {/* ── 영역별 카드 그리드 ─────────────────────────────────── */}
      <section className="mt-4">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">영역별 성적</h2>
        <div className="grid grid-cols-3 gap-3">
          <DomainCard
            icon={BookOpen} title="독해"
            rate={avgReading} classAvg={classContext?.classAvgReading}
            prevRate={previous?.avgReading} series={readingSeries}
          />
          <DomainCard
            icon={BookText} title="어휘"
            rate={avgVocab} classAvg={classContext?.classAvgVocab}
            prevRate={previous?.avgVocab} series={vocabSeries}
          />
          <DomainCard
            icon={ClipboardCheck} title="과제"
            rate={avgHomework} classAvg={classContext?.classAvgHomework}
            prevRate={previous?.avgHomework} series={homeworkSeries}
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-right">
          총 {totalCorrect}/{totalQuestions}문항 정답 · {weekRows.length}주 데이터
          {classContext?.classAvgOverall != null && ' · 세로선 = 반 평균'}
        </p>
      </section>

      {/* ── 성장 추이 + 레이더 ─────────────────────────────────── */}
      {weekRows.length > 0 && (
        <section className="mt-4 grid grid-cols-[2fr_1fr] gap-3">
          <div className="rounded-xl border border-gray-100 p-3">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">주차별 성장 추이</h2>
            <WeeklyChart
              rows={weekRows}
              classAvgReading={classContext?.classAvgReading}
              classAvgVocab={classContext?.classAvgVocab}
              classAvgHomework={classContext?.classAvgHomework}
            />
          </div>
          <div className="rounded-xl border border-gray-100 p-3 flex flex-col items-center">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1 self-start">영역별 균형</h2>
            <RadarChart
              axes={[
                { label: '독해', value: avgReading, classValue: classContext?.classAvgReading },
                { label: '어휘', value: avgVocab, classValue: classContext?.classAvgVocab },
                { label: '과제', value: avgHomework, classValue: classContext?.classAvgHomework },
                { label: '출석', value: attendRate, classValue: null },
              ]}
              classAvg={!!classContext}
            />
            {classContext && (
              <div className="flex gap-3 mt-1">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: BLUE }} />
                  <span className="text-[9px] text-gray-400">본인</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-slate-400" />
                  <span className="text-[9px] text-gray-400">반 평균</span>
                </div>
              </div>
            )}
            {previous && (
              <div className="mt-2 w-full space-y-1.5 border-t border-gray-100 pt-2">
                <p className="text-[9px] text-gray-400 font-medium">이전 기간 대비</p>
                <PrevCompareBar label="독해" current={avgReading} previous={previous.avgReading} color={BLUE} />
                <PrevCompareBar label="어휘" current={avgVocab} previous={previous.avgVocab} color={GREEN} />
                <PrevCompareBar label="과제" current={avgHomework} previous={previous.avgHomework} color="#F59E0B" />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 핵심 인사이트 ─────────────────────────────────────── */}
      {(strengths.length > 0 || weaknesses.length > 0 || achievements.length > 0) && (
        <section className="mt-4 rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Award className="h-3.5 w-3.5" style={{ color: BLUE }} />
            <h2 className="text-xs font-bold text-gray-900">핵심 인사이트</h2>
          </div>
          <div className="space-y-2.5">
            {strengths.length > 0 && (
              <div className="flex gap-2.5">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                <div>
                  <span className="text-xs font-semibold text-gray-800">잘하는 것 · </span>
                  <span className="text-xs text-gray-600">
                    {strengths.map((s) => `${s.name} ${s.rate}%`).join(' · ')}
                  </span>
                </div>
              </div>
            )}
            {weaknesses.length > 0 && (
              <div className="flex gap-2.5">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-orange-400 shrink-0" />
                <div>
                  <span className="text-xs font-semibold text-gray-800">보완할 것 · </span>
                  <span className="text-xs text-gray-600">
                    {weaknesses.map((w) => `${w.name} ${w.rate}%`).join(' · ')}
                  </span>
                </div>
              </div>
            )}
            {achievements.length > 0 && (
              <div className="flex gap-2.5">
                <span className="mt-0.5 h-2 w-2 rounded-full shrink-0" style={{ background: BLUE }} />
                <div>
                  <span className="text-xs font-semibold text-gray-800">이 기간의 성취 · </span>
                  <span className="text-xs text-gray-600">{achievements.join(' · ')}</span>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 한 줄 요약 ───────────────────────────────────────── */}
      {card.summary_text && (
        <section className="mt-3 rounded-xl p-3.5" style={{ background: 'linear-gradient(135deg, #EBF3FF 0%, #FFFFFF 100%)' }}>
          <p className="text-sm leading-relaxed text-gray-800">{card.summary_text}</p>
        </section>
      )}

      {/* ── 오답 분석 + 유형별 정답률 ──────────────────────────── */}
      {(wrongItems.length > 0 || categoryStats.length > 0) && (() => {
        const qAcc = classContext?.questionAccuracy ?? {}
        const hasClassData = Object.keys(qAcc).length > 0

        const classify = (w: WrongItem): 'solo' | 'hard' | 'common' => {
          const acc = qAcc[w.exam_question_id]
          if (!acc || acc.total === 0) return 'common'
          const pct = (acc.correct / acc.total) * 100
          if (pct >= 70) return 'solo'
          if (pct < 50) return 'hard'
          return 'common'
        }

        const classified = wrongItems.map((w) => ({ ...w, kind: classify(w) }))
        const soloItems = classified.filter((w) => w.kind === 'solo')
        const hardItems = classified.filter((w) => w.kind === 'hard')

        const topTags = (items: typeof classified, n = 4) => {
          const freq: Record<string, number> = {}
          items.forEach((w) => w.tags.forEach((t) => { freq[t] = (freq[t] ?? 0) + 1 }))
          return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t)
        }

        return (
          <section className="mt-4">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">오답 분석</h2>
            <div className="grid grid-cols-[1fr_1fr] gap-3">
              <div className="space-y-2">
                {hasClassData ? (
                  <>
                    <div className="rounded-xl border border-red-100 bg-red-50/50 p-3">
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-2xl font-extrabold tabular-nums text-red-500">{soloItems.length}</span>
                        <span className="text-xs text-red-400">개 · 나만 틀린 문항</span>
                      </div>
                      <p className="text-[9px] text-red-400 mb-1.5">반 정답률 70%↑ — 개인 집중 학습 필요</p>
                      <div className="flex flex-wrap gap-1">
                        {topTags(soloItems).map((t) => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">{t}</span>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-2xl font-extrabold tabular-nums text-amber-500">{hardItems.length}</span>
                        <span className="text-xs text-amber-500">개 · 반 전체 어려운 문항</span>
                      </div>
                      <p className="text-[9px] text-amber-400 mb-1.5">반 정답률 50%↓ — 수업에서 함께 복습 예정</p>
                      <div className="flex flex-wrap gap-1">
                        {topTags(hardItems).map((t) => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{t}</span>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-gray-100 p-3">
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className="text-2xl font-extrabold tabular-nums text-gray-700">{wrongItems.length}</span>
                      <span className="text-xs text-gray-500">개 오답</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {topTags(classified).map((t) => (
                        <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {categoryStats.length > 0 && (
                <div className="rounded-xl border border-gray-100 p-3">
                  <h3 className="text-[10px] font-bold text-gray-400 mb-2.5">유형별 정답률</h3>
                  <div className="space-y-2">
                    {categoryStats.map((c) => {
                      const barColor = c.rate >= 80 ? GREEN : c.rate >= 60 ? '#F59E0B' : RED
                      return (
                        <div key={c.name}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[10px] text-gray-700 truncate max-w-[100px]">{c.name}</span>
                            <span className="text-[10px] font-bold tabular-nums ml-1" style={{ color: barColor }}>{c.rate}%</span>
                          </div>
                          <div className="relative h-1.5 rounded-full bg-gray-100">
                            <div className="absolute left-0 top-0 h-full rounded-full"
                              style={{ width: `${c.rate}%`, background: barColor }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )
      })()}

      {/* ── 선생님 코멘트 ─────────────────────────────────────── */}
      {card.teacher_comment && (
        <section className="mt-4 rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
              style={{ background: BLUE }}>
              {(academy.teacher_name ?? '선생님').slice(0, 1)}
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900">{academy.teacher_name ?? '담당 강사'}</p>
              <p className="text-[9px] text-gray-400">강사 코멘트</p>
            </div>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{card.teacher_comment}</p>
        </section>
      )}

      {/* ── 다음 기간 목표 ─────────────────────────────────────── */}
      {focusItems.length > 0 && (
        <section className="mt-3 rounded-xl border border-gray-100 p-4">
          <h3 className="text-xs font-bold text-gray-900 mb-2">다음 기간 학습 목표</h3>
          <ul className="space-y-1.5">
            {focusItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                <Square className="h-3.5 w-3.5 mt-0.5 text-gray-300 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {weekRows.length === 0 && (
        <section className="mt-8 rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <Minus className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-400">이 기간에 채점된 주차 데이터가 없습니다</p>
        </section>
      )}

      {/* ── 푸터 ──────────────────────────────────────────────── */}
      <footer className="mt-6 pt-4 border-t border-gray-200">
        <div className="flex items-end justify-between gap-6">
          <div className="text-[10px] text-gray-400 min-w-0">
            {academy.name && <p className="font-semibold text-gray-600">{academy.name}</p>}
            {academy.address && <p className="mt-0.5 truncate">{academy.address}</p>}
            {academy.phone && <p className="mt-0.5">Tel. {academy.phone}</p>}
          </div>
          <div className="flex gap-6 shrink-0">
            <div className="text-center">
              <div className="w-24 h-9 border-b border-gray-300" />
              <p className="text-[10px] text-gray-400 mt-1">담당 강사</p>
              {academy.teacher_name && <p className="text-[10px] text-gray-500">{academy.teacher_name}</p>}
            </div>
            <div className="text-center">
              <div className="w-24 h-9 border-b border-gray-300" />
              <p className="text-[10px] text-gray-400 mt-1">원장</p>
              {academy.director_name && <p className="text-[10px] text-gray-500">{academy.director_name}</p>}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
