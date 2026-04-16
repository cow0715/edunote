'use client'

import { Minus, Square, BookOpen, BookText, ClipboardCheck } from 'lucide-react'
import type { ReportCard, ReportMetrics, PeriodComparison, ClassContext, AcademyProfile, WeekRow, WrongItem } from '@/lib/report-card'
import { qualitativeColor } from '@/lib/report-card'

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
const DARK = '#111827'
const DARK2 = '#1F2937'

function reportNumber(cardId: string, generatedAt: string): string {
  const d = new Date(generatedAt)
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `RC-${yymmdd}-${cardId.slice(0, 6).toUpperCase()}`
}

function Sparkline({ values, color = BLUE }: { values: (number | null)[]; color?: string }) {
  const nums = values.map((v) => (v === null ? null : Math.max(0, Math.min(100, v))))
  if (nums.filter((v): v is number => v !== null).length < 2) return null
  const w = 60, h = 18, n = nums.length
  const points: { x: number; y: number }[] = []
  nums.forEach((v, i) => {
    if (v === null) return
    points.push({ x: n > 1 ? (i / (n - 1)) * w : w / 2, y: h - (v / 100) * (h - 2) - 1 })
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.6" />
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.5" fill={color} />)}
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
  const W = 480, H = 90, PAD_L = 28, PAD_R = 8, PAD_T = 8, PAD_B = 18
  const cW = W - PAD_L - PAD_R, cH = H - PAD_T - PAD_B
  const n = rows.length
  const xOf = (i: number) => PAD_L + (n === 1 ? cW / 2 : (i / (n - 1)) * cW)
  const yOf = (v: number) => PAD_T + cH - (Math.max(0, Math.min(100, v)) / 100) * cH
  const linePath = (vals: (number | null)[]) => {
    const pts = vals.map((v, i) => v === null ? null : { x: xOf(i), y: yOf(v) }).filter((p): p is { x: number; y: number } => p !== null)
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  }
  const avgLine = (val: number | null | undefined, color: string) => {
    if (val == null) return null
    const y = yOf(val).toFixed(1)
    return <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={color} strokeWidth="0.8" strokeDasharray="3,2" opacity="0.4" />
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
      <path d={linePath(rows.map(r => r.reading_rate))} fill="none" stroke={COLORS.r} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <path d={linePath(rows.map(r => r.vocab_rate))} fill="none" stroke={COLORS.v} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <path d={linePath(rows.map(r => r.homework_rate))} fill="none" stroke={COLORS.h} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {rows.map((row, i) => (
        <g key={row.week_id}>
          {row.reading_rate !== null && <circle cx={xOf(i)} cy={yOf(row.reading_rate)} r="2.5" fill={COLORS.r} />}
          {row.vocab_rate !== null && <circle cx={xOf(i)} cy={yOf(row.vocab_rate)} r="2.5" fill={COLORS.v} />}
          {row.homework_rate !== null && <circle cx={xOf(i)} cy={yOf(row.homework_rate)} r="2.5" fill={COLORS.h} />}
          <text x={xOf(i)} y={H - 3} fontSize="6.5" fill="#9CA3AF" textAnchor="middle">{row.week_number}주</text>
        </g>
      ))}
      {[['독해', COLORS.r], ['어휘', COLORS.v], ['과제', COLORS.h]].map(([label, color], i) => (
        <g key={label} transform={`translate(${PAD_L + i * 46},${PAD_T - 4})`}>
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
  const SIZE = 130, cx = 65, cy = 65, R = 48
  const n = axes.length
  const angleOf = (i: number) => (2 * Math.PI * i / n) - Math.PI / 2
  const ptOf = (i: number, val: number) => {
    const a = angleOf(i), r = R * Math.max(0, Math.min(100, val)) / 100
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }
  const lp = (i: number) => { const a = angleOf(i); return { x: cx + (R + 15) * Math.cos(a), y: cy + (R + 15) * Math.sin(a) } }
  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z'
  const sp = axes.map((ax, i) => ptOf(i, ax.value ?? 0))
  const cp = axes.map((ax, i) => ptOf(i, ax.classValue ?? 0))
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} style={{ display: 'block', margin: '0 auto' }}>
      {[25, 50, 75, 100].map((lv) => <path key={lv} d={toPath(axes.map((_, i) => ptOf(i, lv)))} fill="none" stroke="#E5E7EB" strokeWidth="0.5" />)}
      {axes.map((_, i) => { const p = ptOf(i, 100); return <line key={i} x1={cx} y1={cy} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke="#E5E7EB" strokeWidth="0.5" /> })}
      {classAvg && axes.some((ax) => ax.classValue != null) && <path d={toPath(cp)} fill="#94A3B8" fillOpacity="0.12" stroke="#94A3B8" strokeWidth="1" />}
      <path d={toPath(sp)} fill={BLUE} fillOpacity="0.18" stroke={BLUE} strokeWidth="1.5" />
      {sp.map((p, i) => axes[i].value !== null && <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={BLUE} />)}
      {axes.map((ax, i) => { const l = lp(i); return <text key={i} x={l.x.toFixed(1)} y={l.y.toFixed(1)} fontSize="7.5" fill="#374151" textAnchor="middle" dominantBaseline="middle">{ax.label}</text> })}
    </svg>
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
  const vsClassAvg = overallAvg !== null && classContext?.classAvgOverall != null ? overallAvg - classContext.classAvgOverall : null

  // 영역별 도우미
  const domains = [
    { icon: BookOpen, title: '독해', rate: avgReading, classAvg: classContext?.classAvgReading, prevRate: previous?.avgReading, series: readingSeries },
    { icon: BookText, title: '어휘', rate: avgVocab, classAvg: classContext?.classAvgVocab, prevRate: previous?.avgVocab, series: vocabSeries },
    { icon: ClipboardCheck, title: '과제', rate: avgHomework, classAvg: classContext?.classAvgHomework, prevRate: previous?.avgHomework, series: homeworkSeries },
  ]

  return (
    <div
      className="mx-auto bg-white text-gray-900"
      style={{ fontFamily: "'Plus Jakarta Sans', 'Pretendard', system-ui, sans-serif", maxWidth: '210mm', minHeight: '297mm' }}
    >
      {/* ── 히어로 헤더 (다크) ─────────────────────────────── */}
      <header className="rounded-b-2xl px-7 pt-7 pb-6" style={{ background: DARK }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white leading-tight">{student.name}</h1>
            <p className="text-sm text-gray-400 mt-1">
              {className}
              {academy.teacher_name ? ` · 담당 ${academy.teacher_name} 선생` : ''}
              {[student.school, student.grade].filter(Boolean).length > 0 ? ` · ${[student.school, student.grade].filter(Boolean).join(' ')}` : ''}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {card.period_label} {periodEvalLabel}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-end justify-end gap-1.5">
              <span className="text-6xl font-extrabold tabular-nums text-white leading-none">{overallAvg ?? '-'}</span>
              <div className="pb-1 text-left">
                <p className="text-sm text-gray-400">/ 100점</p>
                {overallDelta !== null && (
                  <p className="text-xs font-bold" style={{ color: overallDelta >= 0 ? GREEN : RED }}>
                    {overallDelta >= 0 ? '▲' : '▼'} {Math.abs(overallDelta)}점
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-2 flex-wrap">
              {classContext?.classRank && (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: BLUE, color: 'white' }}>
                  반 {classContext.classRank}위 / {classContext.classTotalStudents}
                </span>
              )}
              {classContext?.classPercentile && (
                <span className="text-[10px] text-gray-400">상위 {classContext.classPercentile}%</span>
              )}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-600 mt-4">
          {academy.name} · 발급 {new Date(card.generated_at).toLocaleDateString('ko-KR')} · {reportNumber(card.id, card.generated_at)}
        </p>
      </header>

      <div className="px-7">
        {/* ── 요약 카드 3개 ──────────────────────────────────── */}
        <section className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-100 px-4 py-3.5">
            <p className="text-[10px] text-gray-400">지난달 대비</p>
            {overallDelta !== null ? (
              <>
                <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: overallDelta >= 0 ? GREEN : RED }}>
                  {overallDelta >= 0 ? '▲' : '▼'} {Math.abs(overallDelta)}점
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">{previous?.overallAvg}점 → {overallAvg}점</p>
              </>
            ) : <p className="mt-1 text-xl font-bold text-gray-200">데이터 없음</p>}
          </div>
          <div className="rounded-xl border border-gray-100 px-4 py-3.5">
            <p className="text-[10px] text-gray-400">반 평균 대비</p>
            {vsClassAvg !== null ? (
              <>
                <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: vsClassAvg >= 0 ? GREEN : ORANGE }}>
                  {vsClassAvg >= 0 ? '+' : ''}{vsClassAvg}점
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">반 평균 {classContext?.classAvgOverall}점</p>
              </>
            ) : <p className="mt-1 text-xl font-bold text-gray-200">—</p>}
          </div>
          <div className="rounded-xl border border-gray-100 px-4 py-3.5">
            <p className="text-[10px] text-gray-400">출석률</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color: attendRate !== null && attendRate >= 90 ? GREEN : attendRate !== null && attendRate < 80 ? ORANGE : BLUE }}>
              {attendRate ?? '-'}%
            </p>
            {attendanceTotal > 0 && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                이번 달 {attendanceTotal}회 중 {attendedCount}회
              </p>
            )}
          </div>
        </section>

        {/* ── 영역별 현황 (다크 카드) ────────────────────────── */}
        <section className="mt-6">
          <p className="text-xs font-semibold text-gray-500 mb-3">영역별 현황 — 내 아이 점수 vs 반 평균</p>
          <div className="grid grid-cols-2 gap-2.5">
            {domains.map(({ icon: Icon, title, rate, classAvg, prevRate, series }) => {
              const diff = rate !== null && classAvg != null ? rate - classAvg : null
              const prevDelta = rate !== null && prevRate != null ? rate - prevRate : null
              const isWeak = rate !== null && ((diff !== null && diff < -5) || rate < 65)
              const barColor = isWeak ? ORANGE : qualitativeColor(rate)
              return (
                <div key={title} className="rounded-xl px-4 py-3.5" style={{ background: DARK2 }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-sm font-bold text-white">{title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {prevDelta !== null && (
                        <span className="text-[10px] font-semibold" style={{ color: prevDelta >= 0 ? GREEN : RED }}>
                          {prevDelta >= 0 ? '▲' : '▼'}{Math.abs(prevDelta)}
                        </span>
                      )}
                      <span className="text-xl font-extrabold tabular-nums" style={{ color: isWeak ? ORANGE : 'white' }}>
                        {rate ?? '-'}점
                      </span>
                    </div>
                  </div>
                  <div className="relative h-1.5 rounded-full mb-1.5" style={{ background: '#374151' }}>
                    <div className="absolute left-0 top-0 h-full rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, rate ?? 0))}%`, background: barColor }} />
                    {classAvg != null && (
                      <div className="absolute top-[-3px] bottom-[-3px] w-px"
                        style={{ left: `${Math.max(0, Math.min(100, classAvg))}%`, background: '#9CA3AF' }} />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                      {classAvg != null ? (
                        <>반 평균 {classAvg}점{diff !== null && <span className="ml-1 font-semibold" style={{ color: diff >= 0 ? GREEN : ORANGE }}>{diff >= 0 ? `+${diff}` : diff}점</span>}</>
                      ) : '—'}
                      {isWeak && <span className="ml-2 font-semibold" style={{ color: ORANGE }}>▼ 보완 필요</span>}
                    </p>
                    <Sparkline values={series} color={barColor} />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 text-right">
            총 {totalCorrect}/{totalQuestions}문항 · {weekRows.length}주 데이터{classContext ? ' · 세로선 = 반 평균' : ''}
          </p>
        </section>

        {/* ── 성장 추이 ──────────────────────────────────────── */}
        {weekRows.length > 0 && (
          <section className="mt-6">
            <p className="text-xs font-semibold text-gray-500 mb-3">최근 {weekRows.length}주 성장 추이</p>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <div className="rounded-xl border border-gray-100 p-4">
                <WeeklyChart
                  rows={weekRows}
                  classAvgReading={classContext?.classAvgReading}
                  classAvgVocab={classContext?.classAvgVocab}
                  classAvgHomework={classContext?.classAvgHomework}
                />
              </div>
              <div className="rounded-xl border border-gray-100 p-3 flex flex-col items-center justify-center gap-2">
                <p className="text-[10px] font-semibold text-gray-400 self-start">영역별 균형</p>
                <RadarChart
                  axes={[
                    { label: '독해', value: avgReading, classValue: classContext?.classAvgReading },
                    { label: '어휘', value: avgVocab, classValue: classContext?.classAvgVocab },
                    { label: '과제', value: avgHomework, classValue: classContext?.classAvgHomework },
                    { label: '출석', value: attendRate },
                  ]}
                  classAvg={!!classContext}
                />
                {classContext && (
                  <div className="flex gap-3">
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ background: BLUE }} /><span className="text-[9px] text-gray-400">본인</span></div>
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-slate-400" /><span className="text-[9px] text-gray-400">반 평균</span></div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── 핵심 인사이트 ──────────────────────────────────── */}
        {(strengths.length > 0 || weaknesses.length > 0 || achievements.length > 0) && (
          <section className="mt-6">
            <p className="text-xs font-semibold text-gray-500 mb-3">이달의 핵심 인사이트</p>
            <div className="rounded-xl border border-gray-100 p-4 space-y-3">
              {strengths.length > 0 && (
                <div className="flex gap-3">
                  <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ background: GREEN }} />
                  <p className="text-sm text-gray-700 leading-relaxed">
                    <span className="font-semibold text-gray-900">잘하는 것 </span>
                    {strengths.map((s) => `${s.name} ${s.rate}%`).join(' · ')}
                    {strengths[0]?.category_name && `. 특히 ${strengths[0].category_name} 영역에서 뛰어난 수준입니다.`}
                  </p>
                </div>
              )}
              {weaknesses.length > 0 && (
                <div className="flex gap-3">
                  <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ background: ORANGE }} />
                  <p className="text-sm text-gray-700 leading-relaxed">
                    <span className="font-semibold text-gray-900">보완할 것 </span>
                    {weaknesses.map((w) => `${w.name} ${w.rate}%`).join(' · ')}
                    {'. 이 부분에 보완하면 전체 성적 향상이 기대됩니다.'}
                  </p>
                </div>
              )}
              {achievements.length > 0 && (
                <div className="flex gap-3">
                  <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ background: BLUE }} />
                  <p className="text-sm text-gray-700 leading-relaxed">
                    <span className="font-semibold text-gray-900">성장 속도 </span>
                    {achievements.join(' · ')}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── 한 줄 요약 ─────────────────────────────────────── */}
        {card.summary_text && (
          <section className="mt-4 rounded-xl p-4" style={{ background: '#EBF3FF' }}>
            <p className="text-sm leading-relaxed text-gray-800">{card.summary_text}</p>
          </section>
        )}

        {/* ── 오답 분석 + 유형별 정답률 ─────────────────────── */}
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
            <section className="mt-6">
              <p className="text-xs font-semibold text-gray-500 mb-3">오답 분석</p>
              <div className="grid grid-cols-[1fr_1fr] gap-3">
                <div className="space-y-2">
                  {hasClassData ? (
                    <>
                      <div className="rounded-xl border border-red-100 bg-red-50/60 p-3.5">
                        <div className="flex items-baseline gap-1.5 mb-1">
                          <span className="text-2xl font-extrabold tabular-nums text-red-500">{soloItems.length}개</span>
                          <span className="text-xs text-red-400">나만 틀린 문항</span>
                        </div>
                        <p className="text-[9px] text-red-400 mb-2">반 정답률 70%↑ · 개인 집중 학습 필요</p>
                        <div className="flex flex-wrap gap-1">
                          {topTags(soloItems).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">{t}</span>)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3.5">
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
                    <p className="text-[10px] font-semibold text-gray-400 mb-3">유형별 정답률</p>
                    <div className="space-y-2.5">
                      {categoryStats.map((c) => {
                        const barColor = c.rate >= 80 ? GREEN : c.rate >= 60 ? '#F59E0B' : RED
                        return (
                          <div key={c.name}>
                            <div className="flex items-center justify-between mb-1">
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

        {/* ── 선생님 코멘트 (다크) ───────────────────────────── */}
        {card.teacher_comment && (
          <section className="mt-6 rounded-xl p-5" style={{ background: DARK2 }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ background: BLUE }}>
                {(academy.teacher_name ?? 'T').slice(0, 2)}
              </div>
              <div>
                <p className="text-sm font-bold text-white">{academy.teacher_name ?? '담당 강사'} 선생님 코멘트</p>
                <p className="text-[10px] text-gray-400">{academy.name}</p>
              </div>
            </div>
            <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{card.teacher_comment}</p>
          </section>
        )}

        {/* ── 다음 달 목표 (2×2 다크 그리드) ──────────────────── */}
        {focusItems.length > 0 && (
          <section className="mt-4">
            <p className="text-xs font-semibold text-gray-500 mb-3">다음 달 목표</p>
            <div className="grid grid-cols-2 gap-2.5">
              {focusItems.slice(0, 4).map((item, i) => {
                const labels = ['목표', '집중 영역', '추가 과제', '다음 평가일']
                return (
                  <div key={i} className="rounded-xl px-4 py-3.5" style={{ background: DARK2 }}>
                    <p className="text-[10px] text-gray-400 mb-1">{labels[i] ?? `목표 ${i + 1}`}</p>
                    <p className="text-sm font-semibold text-white">{item}</p>
                  </div>
                )
              })}
              {focusItems.length > 4 && (
                <div className="col-span-2 rounded-xl px-4 py-3 border border-gray-100">
                  <ul className="space-y-1.5">
                    {focusItems.slice(4).map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <Square className="h-3.5 w-3.5 mt-0.5 text-gray-300 shrink-0" />
                        <span>{item}</span>
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

        {/* ── 푸터 ────────────────────────────────────────────── */}
        <footer className="mt-8 pt-4 border-t border-gray-100">
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
    </div>
  )
}
