'use client'

import { Minus, Square, BookOpen, BookText, ClipboardCheck, PenLine } from 'lucide-react'
import type { ReportCard, ReportMetrics, PeriodComparison, ClassContext, AcademyProfile, WeekRow, WrongItem } from '@/lib/report-card'
import { qualitativeColor, qualitativeLabel } from '@/lib/report-card'

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

function gradeColor(grade: string): string {
  const g = (grade ?? '').toUpperCase()[0]
  if (g === 'A') return GREEN
  if (g === 'B') return BLUE
  if (g === 'C') return '#F59E0B'
  return RED
}

function reportNumber(cardId: string, generatedAt: string): string {
  const d = new Date(generatedAt)
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `RC-${yymmdd}-${cardId.slice(0, 6).toUpperCase()}`
}

// ── 핵심 인사이트 문장 생성 ────────────────────────────────────────────────
function buildInsightLines(
  avgReading: number | null,
  avgWriting: number | null,
  avgVocab: number | null,
  avgHomework: number | null,
  overallAvg: number | null,
  previous: PeriodComparison | null,
  classContext: ClassContext | null,
  achievements: string[],
): { color: string; text: string }[] {
  const lines: { color: string; text: string }[] = []

  type Domain = { name: string; rate: number; classAvg: number | null }
  const all: Domain[] = []
  if (avgReading !== null) all.push({ name: '독해', rate: avgReading, classAvg: classContext?.classAvgReading ?? null })
  if (avgWriting !== null) all.push({ name: '작문', rate: avgWriting, classAvg: classContext?.classAvgWriting ?? null })
  if (avgVocab !== null) all.push({ name: '어휘', rate: avgVocab, classAvg: classContext?.classAvgVocab ?? null })
  if (avgHomework !== null) all.push({ name: '과제', rate: avgHomework, classAvg: classContext?.classAvgHomework ?? null })
  if (all.length === 0) return lines

  const sortedByRate = [...all].sort((a, b) => b.rate - a.rate)
  const best = sortedByRate[0]
  const worst = sortedByRate[sortedByRate.length - 1]

  // ── 강점 (녹색) ──
  if (classContext) {
    const aboveAvg = all.filter((d) => d.classAvg !== null && d.rate > d.classAvg)
    if (aboveAvg.length >= 2) {
      const names = aboveAvg.map((d) => `${d.name}(${d.rate}%)`).join('·')
      lines.push({ color: GREEN, text: `${names}가 이 반에서 평균 이상을 기록하고 있습니다. 꾸준한 학습 습관이 성과로 이어지고 있습니다.` })
    } else if (aboveAvg.length === 1) {
      const d = aboveAvg[0]
      const diff = d.rate - (d.classAvg ?? 0)
      lines.push({ color: GREEN, text: `${d.name}(${d.rate}%)이 반 평균보다 ${diff}점 높습니다. ${diff >= 10 ? '확실한 강점 영역입니다.' : '반에서 상위권을 유지하고 있습니다.'}` })
    } else {
      lines.push({ color: GREEN, text: `${best.name}(${best.rate}%)이 이번 기간 가장 높은 영역입니다.` })
    }
  } else {
    if (sortedByRate.length >= 2 && best.rate >= 75) {
      const second = sortedByRate[1]
      lines.push({ color: GREEN, text: `${best.name}(${best.rate}%)${best.rate >= 90 ? '에서 우수한 성과를 보였습니다' : '이 이번 기간 강점 영역입니다'}. ${second.name}(${second.rate}%)도 안정적입니다.` })
    } else {
      lines.push({ color: GREEN, text: `${best.name} 정답률 ${best.rate}%로 이번 기간 가장 높은 영역입니다.` })
    }
  }

  // ── 보완 (주황) ──
  const WEAK = 75
  const weak = [...all].filter((d) => d.rate < WEAK).sort((a, b) => a.rate - b.rate)
  if (weak.length > 0) {
    const primary = weak[0]
    let text = `${primary.name}이(가) ${primary.rate}%로 ${WEAK}점 아래입니다.`
    if (weak.length > 1) {
      text += ` ${weak.slice(1).map((d) => `${d.name}(${d.rate}%)`).join('·')}도 집중 연습이 필요합니다.`
    } else if (overallAvg !== null && overallAvg >= 70 && overallAvg < 90) {
      const next = Math.ceil(overallAvg / 10) * 10
      text += ` 이 부분이 보완되면 전체 평균 ${next}점 돌파가 가능합니다.`
    }
    lines.push({ color: ORANGE, text })
  } else if (worst.rate < 85) {
    lines.push({ color: ORANGE, text: `전 영역 ${WEAK}점 이상이지만, ${worst.name}(${worst.rate}%)이 상대적으로 더 연습이 필요합니다. ${85 - worst.rate}점만 더 올리면 전 영역 85% 달성입니다.` })
  }

  // ── 트렌드 (파랑) ──
  const overallDelta = overallAvg !== null && previous?.overallAvg != null ? overallAvg - previous.overallAvg : null
  const streakMatch = achievements.find((a) => /\d+주 연속 점수 상승/.test(a))
  const vsClass = overallAvg !== null && classContext?.classAvgOverall != null ? overallAvg - classContext.classAvgOverall : null

  if (overallDelta !== null) {
    const absD = Math.abs(overallDelta)
    let text: string
    if (overallDelta > 0) {
      text = streakMatch
        ? `${streakMatch.replace('점수 상승', '연속 상승세')}로, 지난 기간보다 ${absD}점 올랐습니다(${previous!.overallAvg}점 → ${overallAvg}점).`
        : `지난 기간 대비 ${absD}점 상승했습니다(${previous!.overallAvg}점 → ${overallAvg}점).`
      if (vsClass !== null && vsClass > 0) text += ` 현재 반 평균(${classContext!.classAvgOverall}점)보다 ${vsClass}점 높은 수준입니다.`
    } else if (overallDelta < 0) {
      text = `지난 기간보다 ${absD}점 하락했습니다(${previous!.overallAvg}점 → ${overallAvg}점). 다음 기간 회복을 기대합니다.`
    } else {
      text = `지난 기간과 같은 수준을 유지했습니다(${overallAvg}점).`
      if (vsClass !== null) text += ` 반 평균 대비 ${vsClass >= 0 ? '+' : ''}${vsClass}점입니다.`
    }
    lines.push({ color: BLUE, text })
  } else if (streakMatch) {
    let text = `${streakMatch.replace('점수 상승', '연속 상승세')}를 이어가고 있습니다.`
    if (vsClass !== null) text += ` 반 평균 대비 ${vsClass >= 0 ? '+' : ''}${vsClass}점 수준을 유지 중입니다.`
    lines.push({ color: BLUE, text })
  } else if (vsClass !== null && overallAvg !== null) {
    lines.push({ color: BLUE, text: `반 평균(${classContext!.classAvgOverall}점) 대비 ${vsClass >= 0 ? '+' : ''}${vsClass}점입니다. ${vsClass > 0 ? '꾸준한 성장을 유지하고 있습니다.' : '반 평균 수준 도달을 목표로 함께 노력해봅시다.'}` })
  }

  return lines
}

function WeeklyChart({ rows, classAvgReading, classAvgVocab, classAvgHomework }: {
  rows: WeekRow[]
  classAvgReading?: number | null
  classAvgVocab?: number | null
  classAvgHomework?: number | null
}) {
  if (rows.length === 0) return null
  const W = 480, H = 128, PAD_L = 26, PAD_R = 8, PAD_T = 8, PAD_B = 18
  const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B, n = rows.length
  const xOf = (i: number) => PAD_L + (n === 1 ? cW / 2 : (i / (n - 1)) * cW)
  const yOf = (v: number) => PAD_T + cH - (Math.max(0, Math.min(100, v)) / 100) * cH
  const linePath = (vals: (number | null)[]) =>
    vals.map((v, i) => v === null ? null : { x: xOf(i), y: yOf(v) })
      .filter((p): p is { x: number; y: number } => p !== null)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const avgLine = (val: number | null | undefined, color: string) => {
    if (val == null) return null
    const y = yOf(val).toFixed(1)
    return <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={color} strokeWidth="0.8" strokeDasharray="3,2" opacity="0.4" />
  }
  const C = { r: BLUE, v: GREEN, h: '#F59E0B' }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={PAD_L} y1={yOf(v)} x2={W - PAD_R} y2={yOf(v)} stroke="#F3F4F6" strokeWidth="0.8" />
          <text x={PAD_L - 3} y={yOf(v) + 3} fontSize="6" fill="#D1D5DB" textAnchor="end">{v}</text>
        </g>
      ))}
      {avgLine(classAvgReading, C.r)} {avgLine(classAvgVocab, C.v)} {avgLine(classAvgHomework, C.h)}
      <path d={linePath(rows.map(r => r.reading_rate))} fill="none" stroke={C.r} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <path d={linePath(rows.map(r => r.vocab_rate))} fill="none" stroke={C.v} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <path d={linePath(rows.map(r => r.homework_rate))} fill="none" stroke={C.h} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {rows.map((row, i) => (
        <g key={row.week_id}>
          {row.reading_rate !== null && <circle cx={xOf(i)} cy={yOf(row.reading_rate)} r="2.5" fill={C.r} />}
          {row.vocab_rate !== null && <circle cx={xOf(i)} cy={yOf(row.vocab_rate)} r="2.5" fill={C.v} />}
          {row.homework_rate !== null && <circle cx={xOf(i)} cy={yOf(row.homework_rate)} r="2.5" fill={C.h} />}
          <text x={xOf(i)} y={H - 3} fontSize="6.5" fill="#9CA3AF" textAnchor="middle">{row.week_number}주</text>
        </g>
      ))}
      {[['독해', C.r], ['어휘', C.v], ['과제', C.h]].map(([label, color], i) => (
        <g key={label} transform={`translate(${PAD_L + i * 46},${PAD_T - 3})`}>
          <line x1="0" y1="3" x2="9" y2="3" stroke={color} strokeWidth="1.8" />
          <text x="11" y="6" fontSize="6.5" fill={color as string}>{label}</text>
        </g>
      ))}
    </svg>
  )
}

function RadarChart({ axes, classAvg }: {
  axes: { label: string; value: number | null; classValue?: number | null }[]
  classAvg?: boolean
}) {
  const SIZE = 140, cx = 70, cy = 70, R = 52, n = axes.length
  const angle = (i: number) => (2 * Math.PI * i / n) - Math.PI / 2
  const pt = (i: number, val: number) => { const a = angle(i), r = R * Math.max(0, Math.min(100, val)) / 100; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) } }
  const lpt = (i: number) => { const a = angle(i); return { x: cx + (R + 16) * Math.cos(a), y: cy + (R + 16) * Math.sin(a) } }
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z'
  const sp = axes.map((ax, i) => pt(i, ax.value ?? 0))
  const cp = axes.map((ax, i) => pt(i, ax.classValue ?? 0))
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} style={{ display: 'block', margin: '0 auto' }}>
      {[25, 50, 75, 100].map((lv) => <path key={lv} d={path(axes.map((_, i) => pt(i, lv)))} fill="none" stroke="#F3F4F6" strokeWidth="0.8" />)}
      {axes.map((_, i) => { const p = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke="#F3F4F6" strokeWidth="0.8" /> })}
      {classAvg && axes.some((ax) => ax.classValue != null) && <path d={path(cp)} fill="#94A3B8" fillOpacity="0.1" stroke="#94A3B8" strokeWidth="1" />}
      <path d={path(sp)} fill={BLUE} fillOpacity="0.12" stroke={BLUE} strokeWidth="1.5" />
      {sp.map((p, i) => axes[i].value !== null && <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={BLUE} />)}
      {axes.map((ax, i) => { const l = lpt(i); return <text key={i} x={l.x.toFixed(1)} y={l.y.toFixed(1)} fontSize="7.5" fill="#374151" textAnchor="middle" dominantBaseline="middle">{ax.label}</text> })}
    </svg>
  )
}

function DomainCard({ icon: Icon, title, rate, classAvg, prevRate }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  rate: number | null
  classAvg?: number | null
  prevRate?: number | null
}) {
  const diff = rate !== null && classAvg != null ? rate - classAvg : null
  const prevDelta = rate !== null && prevRate != null ? rate - prevRate : null
  const isWeak = rate !== null && ((diff !== null && diff < -5) || rate < 65)
  const barColor = isWeak ? ORANGE : qualitativeColor(rate)

  return (
    <div className={`rounded-xl border p-3.5 ${isWeak ? 'border-orange-200 bg-orange-50/30' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 ${isWeak ? 'text-orange-400' : 'text-gray-400'}`} />
          <span className="text-xs font-semibold text-gray-700">{title}</span>
          {isWeak && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-500">보완 필요</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {prevDelta !== null && (
            <span className="text-[10px] font-semibold" style={{ color: prevDelta >= 0 ? GREEN : RED }}>
              {prevDelta >= 0 ? '▲' : '▼'}{Math.abs(prevDelta)}
            </span>
          )}
          <span className="text-xl font-extrabold tabular-nums" style={{ color: barColor }}>
            {rate ?? '-'}
          </span>
          {rate !== null && <span className="text-xs text-gray-400">%</span>}
        </div>
      </div>
      <div className="relative h-1.5 rounded-full bg-gray-100 mb-1.5">
        <div className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, rate ?? 0))}%`, background: barColor }} />
        {classAvg != null && (
          <div className="absolute top-[-3px] bottom-[-3px] w-px bg-gray-400"
            style={{ left: `${Math.max(0, Math.min(100, classAvg))}%` }} />
        )}
      </div>
      <p className="text-[10px] text-gray-400">
        {classAvg != null ? (
          <>반 평균 {classAvg}%{diff !== null && <span className="ml-1 font-semibold" style={{ color: diff >= 0 ? GREEN : ORANGE }}>{diff >= 0 ? `+${diff}` : diff}</span>}</>
        ) : qualitativeLabel(rate)}
      </p>
    </div>
  )
}

export function ReportCardPreview({ student, card, metrics, previous, academy, classContext }: Props) {
  const {
    weekRows, avgReading, avgWriting, avgVocab, avgHomework, overallAvg,
    attendancePresent, attendanceLate, attendanceAbsent, attendanceTotal,
    categoryStats, totalQuestions, totalCorrect, achievements,
    wrongItems,
  } = metrics

  const attendedCount = attendancePresent + attendanceLate
  const attendRate = attendanceTotal > 0 ? Math.round((attendedCount / attendanceTotal) * 100) : null
  const className = weekRows[0]?.class_name ?? '-'
  const focusItems = (card.next_focus ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
  const periodEvalLabel = card.period_type === 'monthly' ? '월간 평가'
    : card.period_type === 'quarterly' ? '분기 평가' : '학기 평가'

  const overallDelta = overallAvg !== null && previous?.overallAvg != null ? overallAvg - previous.overallAvg : null
  const vsClassAvg = overallAvg !== null && classContext?.classAvgOverall != null ? overallAvg - classContext.classAvgOverall : null

  const insightLines = buildInsightLines(
    avgReading, avgWriting, avgVocab, avgHomework,
    overallAvg, previous, classContext, achievements,
  )

  const radarAxes = [
    { label: '독해', value: avgReading, classValue: classContext?.classAvgReading ?? null },
    ...(avgWriting !== null ? [{ label: '작문', value: avgWriting, classValue: classContext?.classAvgWriting ?? null }] : []),
    { label: '어휘', value: avgVocab, classValue: classContext?.classAvgVocab ?? null },
    { label: '과제', value: avgHomework, classValue: classContext?.classAvgHomework ?? null },
  ]

  return (
    <div
      className="mx-auto bg-white text-gray-900"
      style={{ fontFamily: "'Plus Jakarta Sans', 'Pretendard', system-ui, sans-serif", maxWidth: '210mm', minHeight: '297mm', padding: '28px' }}
    >
      {/* ── 헤더 ─────────────────────────────────────────────── */}
      <header className="pb-5 border-b-2 border-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] text-gray-400 mb-1">{academy.name} · {periodEvalLabel}</p>
            <h1 className="text-3xl font-extrabold tracking-tight leading-none">{student.name}</h1>
            <p className="text-sm text-gray-500 mt-1.5">
              {className}
              {academy.teacher_name ? ` · 담당 ${academy.teacher_name} 선생` : ''}
              {[student.school, student.grade].filter(Boolean).length > 0 ? ` · ${[student.school, student.grade].filter(Boolean).join(' ')}` : ''}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">{card.period_label} · 발급 {new Date(card.generated_at).toLocaleDateString('ko-KR')} · {reportNumber(card.id, card.generated_at)}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* 종합 등급 — 눈에 띄게 */}
            {card.overall_grade && (
              <div className="flex flex-col items-center gap-0.5">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl font-black"
                  style={{ background: gradeColor(card.overall_grade) + '18', color: gradeColor(card.overall_grade) }}
                >
                  {card.overall_grade}
                </div>
                <span className="text-[9px] text-gray-400">종합 등급</span>
              </div>
            )}
            <div className="text-right">
              <div className="flex items-end justify-end gap-1.5">
                <span className="text-5xl font-extrabold tabular-nums leading-none" style={{ color: BLUE }}>{overallAvg ?? '-'}</span>
                <div className="pb-0.5">
                  <p className="text-sm text-gray-400">/ 100</p>
                  {overallDelta !== null && (
                    <p className="text-xs font-bold text-right" style={{ color: overallDelta >= 0 ? GREEN : RED }}>
                      {overallDelta >= 0 ? '▲' : '▼'}{Math.abs(overallDelta)}점
                    </p>
                  )}
                </div>
              </div>
              {classContext?.classRank && (
                <div className="flex items-center justify-end mt-2">
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: '#EBF3FF', color: BLUE }}>
                    반 {classContext.classRank}위 / {classContext.classTotalStudents}명
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── 요약 3카드 ───────────────────────────────────────── */}
      <section className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-gray-50 px-4 py-3.5">
          <p className="text-[10px] text-gray-400">지난 기간 대비</p>
          {overallDelta !== null ? (
            <>
              <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: overallDelta >= 0 ? GREEN : RED }}>
                {overallDelta >= 0 ? '▲' : '▼'} {Math.abs(overallDelta)}점
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">{previous?.overallAvg}점 → {overallAvg}점</p>
            </>
          ) : <p className="mt-2 text-sm text-gray-300">이전 데이터 없음</p>}
        </div>
        <div className="rounded-xl bg-gray-50 px-4 py-3.5">
          <p className="text-[10px] text-gray-400">반 평균 대비</p>
          {vsClassAvg !== null ? (
            <>
              <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: vsClassAvg >= 0 ? GREEN : ORANGE }}>
                {vsClassAvg >= 0 ? '+' : ''}{vsClassAvg}점
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">반 평균 {classContext?.classAvgOverall}점</p>
            </>
          ) : <p className="mt-2 text-sm text-gray-300">—</p>}
        </div>
        <div className="rounded-xl bg-gray-50 px-4 py-3.5">
          <p className="text-[10px] text-gray-400">출석률</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums"
            style={{ color: attendRate !== null && attendRate >= 90 ? GREEN : attendRate !== null && attendRate < 80 ? ORANGE : BLUE }}>
            {attendRate ?? '-'}%
          </p>
          {attendanceTotal > 0 && (
            <p className="text-[10px] text-gray-400 mt-0.5">출석 {attendancePresent} · 지각 {attendanceLate} · 결석 {attendanceAbsent}</p>
          )}
        </div>
      </section>

      {/* ── 영역별 카드 (스파크라인 제거) ────────────────────────── */}
      <section className="mt-5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">영역별 성적 — 내 점수 vs 반 평균</p>
        <div className={`grid gap-2.5 ${avgWriting !== null ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <DomainCard
            icon={BookOpen} title="독해"
            rate={avgReading} classAvg={classContext?.classAvgReading}
            prevRate={previous?.avgReading}
          />
          {avgWriting !== null && (
            <DomainCard
              icon={PenLine} title="작문"
              rate={avgWriting} classAvg={classContext?.classAvgWriting ?? null}
              prevRate={null}
            />
          )}
          <DomainCard
            icon={BookText} title="어휘"
            rate={avgVocab} classAvg={classContext?.classAvgVocab}
            prevRate={previous?.avgVocab}
          />
          <DomainCard
            icon={ClipboardCheck} title="과제"
            rate={avgHomework} classAvg={classContext?.classAvgHomework}
            prevRate={previous?.avgHomework}
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-right">
          총 {totalCorrect}/{totalQuestions}문항 · {weekRows.length}주 데이터{classContext ? ' · 세로선 = 반 평균' : ''}
        </p>
      </section>

      {/* ── 이달의 핵심 인사이트 ────────────────────────────────── */}
      {insightLines.length > 0 && (
        <section className="mt-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">이달의 핵심 인사이트</p>
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
            {insightLines.map((line, i) => (
              <div key={i} className="flex gap-3 px-4 py-3.5">
                <span className="mt-[5px] w-2 h-2 rounded-full shrink-0" style={{ background: line.color }} />
                <p className="text-sm text-gray-700 leading-relaxed">{line.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 성장 추이 + 역량 레이더 (높이 정렬) ─────────────────── */}
      {weekRows.length > 0 && (
        <section className="mt-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">성장 추이</p>
          <div className="grid grid-cols-[2fr_1fr] gap-3 items-stretch">
            {/* 좌: 주간 라인 차트 */}
            <div className="rounded-xl border border-gray-100 p-3.5 flex items-center">
              <WeeklyChart
                rows={weekRows}
                classAvgReading={classContext?.classAvgReading}
                classAvgVocab={classContext?.classAvgVocab}
                classAvgHomework={classContext?.classAvgHomework}
              />
            </div>
            {/* 우: 레이더 차트 */}
            <div className="rounded-xl border border-gray-100 p-3 flex flex-col items-center justify-between">
              <p className="text-[10px] font-semibold text-gray-400 self-start">역량 지도</p>
              <RadarChart axes={radarAxes} classAvg={!!classContext} />
              {classContext && (
                <div className="flex gap-3 mt-1">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: BLUE }} />
                    <span className="text-[9px] text-gray-400">본인</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-slate-300" />
                    <span className="text-[9px] text-gray-400">반 평균</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── 오답 분석 ─────────────────────────────────────────────── */}
      {(wrongItems.length > 0 || categoryStats.length > 0) && (() => {
        const qAcc = classContext?.questionAccuracy ?? {}
        const hasClassData = Object.keys(qAcc).length > 0
        const classify = (w: WrongItem): 'solo' | 'hard' | 'common' => {
          const acc = qAcc[w.exam_question_id]
          if (!acc || acc.total === 0) return 'common'
          const pct = (acc.correct / acc.total) * 100
          return pct >= 70 ? 'solo' : pct < 50 ? 'hard' : 'common'
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
          <section className="mt-5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">오답 분석</p>
            <div className="grid grid-cols-[1fr_1fr] gap-3">
              <div className="space-y-2">
                {hasClassData ? (
                  <>
                    <div className="rounded-xl border border-red-100 bg-red-50/50 p-3.5">
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-2xl font-extrabold tabular-nums text-red-500">{soloItems.length}개</span>
                        <span className="text-xs text-red-400">나만 틀린 문항</span>
                      </div>
                      <p className="text-[9px] text-red-400 mb-2">반 정답률 70%↑ · 개인 집중 학습 필요</p>
                      <div className="flex flex-wrap gap-1">
                        {topTags(soloItems).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">{t}</span>)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3.5">
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-2xl font-extrabold tabular-nums text-amber-500">{hardItems.length}개</span>
                        <span className="text-xs text-amber-500">반 전체 어려운 문항</span>
                      </div>
                      <p className="text-[9px] text-amber-400 mb-2">반 정답률 50%↓ · 수업에서 함께 복습 예정</p>
                      <div className="flex flex-wrap gap-1">
                        {topTags(hardItems).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{t}</span>)}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-gray-100 p-3.5">
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className="text-2xl font-extrabold tabular-nums text-gray-700">{wrongItems.length}개</span>
                      <span className="text-xs text-gray-500">오답</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {topTags(classified).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{t}</span>)}
                    </div>
                  </div>
                )}
              </div>
              {categoryStats.length > 0 && (
                <div className="rounded-xl border border-gray-100 p-3.5">
                  <p className="text-[10px] font-semibold text-gray-400 mb-2.5">유형별 정답률</p>
                  <div className="space-y-2.5">
                    {categoryStats.map((c) => {
                      const barColor = c.rate >= 80 ? GREEN : c.rate >= 60 ? '#F59E0B' : RED
                      return (
                        <div key={c.name}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[10px] text-gray-700 truncate max-w-[100px]">{c.name}</span>
                            <span className="text-[10px] font-bold tabular-nums ml-1" style={{ color: barColor }}>{c.rate}%</span>
                          </div>
                          <div className="relative h-1.5 rounded-full bg-gray-100">
                            <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${c.rate}%`, background: barColor }} />
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

      {/* ── 선생님 메시지 ─────────────────────────────────────────── */}
      {(card.summary_text || card.teacher_comment) && (
        <section className="mt-5 rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ background: BLUE }}>
              {(academy.teacher_name ?? 'T').slice(0, 2)}
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900">{academy.teacher_name ?? '담당 강사'} 선생님 메시지</p>
              <p className="text-[9px] text-gray-400">{academy.name}</p>
            </div>
          </div>
          {card.summary_text && (
            <p className="text-sm text-gray-500 italic border-l-2 border-gray-200 pl-3 mb-3 leading-relaxed">{card.summary_text}</p>
          )}
          {card.teacher_comment && (
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{card.teacher_comment}</p>
          )}
        </section>
      )}

      {/* ── 다음 기간 목표 ─────────────────────────────────────────── */}
      {focusItems.length > 0 && (
        <section className="mt-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">다음 달 목표</p>
          <div className="grid grid-cols-2 gap-2.5">
            {focusItems.slice(0, 4).map((item, i) => {
              const labels = ['목표 점수', '집중 영역', '추가 과제', '다음 평가일']
              return (
                <div key={i} className="rounded-xl border border-gray-100 px-4 py-3.5">
                  <p className="text-[10px] text-gray-400 mb-1">{labels[i] ?? `목표 ${i + 1}`}</p>
                  <p className="text-sm font-semibold text-gray-900">{item}</p>
                </div>
              )
            })}
            {focusItems.length > 4 && (
              <div className="col-span-2 rounded-xl border border-gray-100 px-4 py-3">
                <ul className="space-y-1.5">
                  {focusItems.slice(4).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <Square className="h-3.5 w-3.5 mt-0.5 text-gray-300 shrink-0" /><span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {weekRows.length === 0 && (
        <section className="mt-8 rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <Minus className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-400">이 기간에 채점된 주차 데이터가 없습니다</p>
        </section>
      )}

      {/* ── 푸터 ──────────────────────────────────────────────── */}
      <footer className="mt-8 pt-4 border-t border-gray-200">
        <div className="flex items-end justify-between gap-6">
          <div className="text-[10px] text-gray-400 min-w-0">
            {academy.name && <p className="font-semibold text-gray-500">{academy.name}</p>}
            {academy.address && <p className="mt-0.5 truncate">{academy.address}</p>}
            {academy.phone && <p className="mt-0.5">Tel. {academy.phone}</p>}
          </div>
          <div className="flex gap-8 shrink-0">
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
