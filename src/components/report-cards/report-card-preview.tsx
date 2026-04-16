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

function reportNumber(cardId: string, generatedAt: string): string {
  const d = new Date(generatedAt)
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `RC-${yymmdd}-${cardId.slice(0, 6).toUpperCase()}`
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const nums = values.map((v) => (v === null ? null : Math.max(0, Math.min(100, v))))
  const valid = nums.filter((v): v is number => v !== null)
  if (valid.length < 1) return <span className="text-[10px] text-gray-300">—</span>
  const w = 60, h = 18
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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none">
      {points.length > 1 && <path d={path} fill="none" stroke={BLUE} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.2" fill={BLUE} />)}
    </svg>
  )
}

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] text-gray-400">{label}</p>
      <p className="text-xs font-semibold text-gray-900 mt-0.5 truncate">{value || '-'}</p>
    </div>
  )
}

function MetricCard({ label, primary, secondary, color = BLUE }: {
  label: string
  primary: React.ReactNode
  secondary?: React.ReactNode
  color?: string
}) {
  return (
    <div className="rounded-xl bg-gray-50 px-4 py-3">
      <p className="text-[10px] text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums" style={{ color }}>{primary}</p>
      {secondary && <p className="text-[10px] text-gray-400 mt-0.5">{secondary}</p>}
    </div>
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
  const COLORS = { r: '#2463EB', v: '#10B981', h: '#F59E0B' }
  const readingVals = rows.map(r => r.reading_rate)
  const vocabVals = rows.map(r => r.vocab_rate)
  const homeworkVals = rows.map(r => r.homework_rate)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
      {/* y-grid */}
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={PAD_L} y1={yOf(v)} x2={W - PAD_R} y2={yOf(v)} stroke="#E5E7EB" strokeWidth="0.5" />
          <text x={PAD_L - 3} y={yOf(v) + 3} fontSize="6" fill="#9CA3AF" textAnchor="end">{v}</text>
        </g>
      ))}
      {/* class avg lines */}
      {avgLine(classAvgReading, COLORS.r)}
      {avgLine(classAvgVocab, COLORS.v)}
      {avgLine(classAvgHomework, COLORS.h)}
      {/* data lines */}
      <path d={linePath(readingVals)} fill="none" stroke={COLORS.r} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={linePath(vocabVals)} fill="none" stroke={COLORS.v} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={linePath(homeworkVals)} fill="none" stroke={COLORS.h} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* dots + x labels */}
      {rows.map((row, i) => (
        <g key={row.week_id}>
          {row.reading_rate !== null && <circle cx={xOf(i)} cy={yOf(row.reading_rate)} r="2" fill={COLORS.r} />}
          {row.vocab_rate !== null && <circle cx={xOf(i)} cy={yOf(row.vocab_rate)} r="2" fill={COLORS.v} />}
          {row.homework_rate !== null && <circle cx={xOf(i)} cy={yOf(row.homework_rate)} r="2" fill={COLORS.h} />}
          <text x={xOf(i)} y={H - 3} fontSize="6" fill="#9CA3AF" textAnchor="middle">{row.week_number}주</text>
        </g>
      ))}
      {/* legend */}
      {[['독해', COLORS.r], ['어휘', COLORS.v], ['과제', COLORS.h]].map(([label, color], i) => (
        <g key={label} transform={`translate(${PAD_L + i * 42},${PAD_T - 2})`}>
          <line x1="0" y1="3" x2="8" y2="3" stroke={color} strokeWidth="1.5" />
          <text x="10" y="6" fontSize="6.5" fill={color as string}>{label}</text>
        </g>
      ))}
    </svg>
  )
}

function RadarChart({ axes, student, classAvg }: {
  axes: { label: string; value: number | null; classValue?: number | null }[]
  student?: string  // unused, for future label
  classAvg?: boolean
}) {
  const SIZE = 120
  const cx = SIZE / 2, cy = SIZE / 2
  const R = 44  // outer radius
  const n = axes.length
  const angleOf = (i: number) => (2 * Math.PI * i / n) - Math.PI / 2
  const ptOf = (i: number, val: number) => {
    const a = angleOf(i)
    const r = R * Math.max(0, Math.min(100, val)) / 100
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }
  const labelPtOf = (i: number) => {
    const a = angleOf(i)
    return { x: cx + (R + 14) * Math.cos(a), y: cy + (R + 14) * Math.sin(a) }
  }

  const gridLevels = [25, 50, 75, 100]
  const studentPoly = axes.map((ax, i) => ptOf(i, ax.value ?? 0))
  const classPoly = axes.map((ax, i) => ptOf(i, ax.classValue ?? 0))
  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + 'Z'

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} style={{ display: 'block', margin: '0 auto' }}>
      {/* grid polygons */}
      {gridLevels.map((lv) => {
        const pts = axes.map((_, i) => ptOf(i, lv))
        return <path key={lv} d={toPath(pts)} fill="none" stroke="#E5E7EB" strokeWidth="0.5" />
      })}
      {/* axis lines */}
      {axes.map((_, i) => {
        const p = ptOf(i, 100)
        return <line key={i} x1={cx} y1={cy} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke="#E5E7EB" strokeWidth="0.5" />
      })}
      {/* class avg polygon */}
      {classAvg && axes.some((ax) => ax.classValue != null) && (
        <path d={toPath(classPoly)} fill="#94A3B8" fillOpacity="0.12" stroke="#94A3B8" strokeWidth="1" />
      )}
      {/* student polygon */}
      <path d={toPath(studentPoly)} fill={BLUE} fillOpacity="0.15" stroke={BLUE} strokeWidth="1.5" />
      {/* student dots */}
      {studentPoly.map((p, i) => (
        axes[i].value !== null && <circle key={i} cx={p.x} cy={p.y} r="2" fill={BLUE} />
      ))}
      {/* labels */}
      {axes.map((ax, i) => {
        const lp = labelPtOf(i)
        return (
          <text key={i} x={lp.x.toFixed(1)} y={lp.y.toFixed(1)}
            fontSize="7" fill="#374151" textAnchor="middle" dominantBaseline="middle">
            {ax.label}
          </text>
        )
      })}
      {/* center 50% label */}
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
            <span className="text-[10px] font-semibold" style={{ color: delta >= 0 ? '#10B981' : '#EF4444' }}>
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
        <div className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, current))}%`, background: color }} />
      </div>
      {previous !== null && (
        <p className="text-[9px] text-gray-400 mt-0.5">이전 기간 {previous}%</p>
      )}
    </div>
  )
}

function DomainRow({ icon: Icon, title, rate, classAvg, series }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  rate: number | null
  classAvg: number | null | undefined
  series: (number | null)[]
}) {
  const label = qualitativeLabel(rate)
  const color = qualitativeColor(rate)
  const barValue = rate ?? 0
  const avgValue = classAvg ?? 0
  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-xs font-medium text-gray-800">{title}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-sm font-bold tabular-nums text-gray-900">{rate ?? '-'}</span>
        {rate !== null && <span className="text-[10px] text-gray-400">%</span>}
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${color}14`, color }}>
          {label}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-gray-500">
        {classAvg ?? '-'}{classAvg !== null && classAvg !== undefined && '%'}
      </td>
      <td className="px-3 py-2.5">
        <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, barValue))}%`, background: color }} />
          {classAvg !== null && classAvg !== undefined && (
            <div className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-gray-500" style={{ left: `${Math.max(0, Math.min(100, avgValue))}%` }} title={`반 평균 ${classAvg}%`} />
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <Sparkline values={series} />
      </td>
    </tr>
  )
}

export function ReportCardPreview({ student, card, metrics, previous, academy, classContext }: Props) {
  const {
    weekRows, avgReading, avgVocab, avgHomework, overallAvg,
    attendancePresent, attendanceLate, attendanceAbsent, attendanceTotal,
    strengths, weaknesses, totalQuestions, totalCorrect, achievements,
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
      {/* 학원 헤더 */}
      <header className="pb-4 border-b border-gray-200">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">{student.name}</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {academy.name ?? '학원 정보 설정 필요'}
              {academy.english_name ? ` · ${academy.english_name}` : ''}
              {academy.address ? ` · ${academy.address}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-gray-900">학업 성적표</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{card.period_label} · {periodEvalLabel}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">발급번호 {reportNumber(card.id, card.generated_at)}</p>
          </div>
        </div>
      </header>

      {/* 학생 정보 그리드 */}
      <section className="mt-4 rounded-xl border border-gray-100 bg-gray-50/50 grid grid-cols-3 divide-x divide-gray-100">
        <InfoCell label="이름" value={student.name} />
        <InfoCell label="반" value={className} />
        <InfoCell label="학년" value={[student.school, student.grade].filter(Boolean).join(' ') || '-'} />
        <InfoCell label="학생 번호" value={student.student_code ?? '-'} />
        <InfoCell label="담당 강사" value={academy.teacher_name ?? '-'} />
        <InfoCell label="발행일" value={new Date(card.generated_at).toLocaleDateString('ko-KR')} />
      </section>

      {/* 4대 지표 카드 */}
      <section className="mt-4 grid grid-cols-4 gap-3">
        <MetricCard
          label="종합 점수"
          primary={<>{overallAvg ?? '-'}<span className="text-sm font-medium text-gray-400">/100</span></>}
        />
        <MetricCard
          label="종합 등급"
          primary={card.overall_grade ?? '-'}
          secondary={previous && previous.overallAvg !== null ? `전 기간 ${previous.overallAvg}%` : undefined}
        />
        <MetricCard
          label="반 석차"
          primary={
            classContext && classContext.classRank
              ? <>{classContext.classRank}<span className="text-sm font-medium text-gray-400">/{classContext.classTotalStudents}명</span></>
              : '-'
          }
          secondary={classContext?.classPercentile ? `상위 ${classContext.classPercentile}%` : undefined}
        />
        <MetricCard
          label="출석률"
          primary={attendRate !== null ? <>{attendRate}<span className="text-sm font-medium text-gray-400">%</span></> : '-'}
          secondary={attendanceTotal > 0 ? `출석 ${attendancePresent} · 지각 ${attendanceLate} · 결석 ${attendanceAbsent}` : undefined}
        />
      </section>

      {/* 영역별 성적 표 */}
      <section className="mt-5">
        <h2 className="text-sm font-bold text-gray-900 mb-2">영역별 성적</h2>
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">평가 영역</th>
                <th className="px-3 py-2 text-right font-medium">점수</th>
                <th className="px-3 py-2 text-center font-medium">평가</th>
                <th className="px-3 py-2 text-right font-medium">반 평균</th>
                <th className="px-3 py-2 text-left font-medium">분포</th>
                <th className="px-3 py-2 text-right font-medium">추이</th>
              </tr>
            </thead>
            <tbody>
              <DomainRow icon={BookOpen} title="독해 (Reading)" rate={avgReading} classAvg={classContext?.classAvgReading} series={readingSeries} />
              <DomainRow icon={BookText} title="어휘 (Vocab)" rate={avgVocab} classAvg={classContext?.classAvgVocab} series={vocabSeries} />
              <DomainRow icon={ClipboardCheck} title="과제 (Homework)" rate={avgHomework} classAvg={classContext?.classAvgHomework} series={homeworkSeries} />
              <tr className="border-t-2 border-gray-200 bg-gray-50/60">
                <td className="px-3 py-2.5 text-xs font-bold text-gray-900">종합</td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-sm font-bold tabular-nums text-gray-900">{overallAvg ?? '-'}</span>
                  {overallAvg !== null && <span className="text-[10px] text-gray-400">%</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: `${qualitativeColor(overallAvg)}14`, color: qualitativeColor(overallAvg) }}>
                    {qualitativeLabel(overallAvg)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right text-xs tabular-nums text-gray-500">
                  {classContext?.classAvgOverall ?? '-'}{classContext?.classAvgOverall !== null && classContext?.classAvgOverall !== undefined ? '%' : ''}
                </td>
                <td className="px-3 py-2.5" colSpan={2}>
                  <p className="text-[10px] text-gray-400">
                    총 {totalCorrect}/{totalQuestions}문항 · 채점 주차 {weekRows.length}주
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 주차별 성적 추이 + 레이더 차트 */}
      {weekRows.length > 0 && (
        <section className="mt-4 grid grid-cols-[2fr_1fr] gap-3">
          <div className="rounded-xl border border-gray-100 p-3">
            <h2 className="text-xs font-bold text-gray-900 mb-2">주차별 성적 추이</h2>
            <WeeklyChart
              rows={weekRows}
              classAvgReading={classContext?.classAvgReading}
              classAvgVocab={classContext?.classAvgVocab}
              classAvgHomework={classContext?.classAvgHomework}
            />
          </div>
          <div className="rounded-xl border border-gray-100 p-3 flex flex-col items-center">
            <h2 className="text-xs font-bold text-gray-900 mb-1 self-start">영역별 균형</h2>
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
                  <span className="text-[9px] text-gray-500">본인</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-slate-400" />
                  <span className="text-[9px] text-gray-500">반 평균</span>
                </div>
              </div>
            )}
            {previous && (
              <div className="mt-2 w-full space-y-1.5">
                <p className="text-[9px] text-gray-400 font-medium">이전 기간 대비</p>
                <PrevCompareBar label="독해" current={avgReading} previous={previous.avgReading} color="#2463EB" />
                <PrevCompareBar label="어휘" current={avgVocab} previous={previous.avgVocab} color="#10B981" />
                <PrevCompareBar label="과제" current={avgHomework} previous={previous.avgHomework} color="#F59E0B" />
              </div>
            )}
          </div>
        </section>
      )}

      {/* 강점 / 약점 + 성취 */}
      <section className="mt-4 grid grid-cols-[1fr_1fr_1fr] gap-3">
        <div className="rounded-xl border border-gray-100 p-3">
          <h3 className="text-xs font-bold text-gray-900 mb-2">강점 Top 3</h3>
          {strengths.length === 0 ? <p className="text-xs text-gray-400">데이터 부족</p> : (
            <ul className="space-y-1.5">
              {strengths.map((s) => (
                <li key={s.name} className="flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-800 truncate">{s.name}</div>
                    {s.category_name && <div className="text-[10px] text-gray-400">{s.category_name}</div>}
                  </div>
                  <span className="font-bold tabular-nums shrink-0 ml-2" style={{ color: BLUE }}>{s.rate}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-gray-100 p-3">
          <h3 className="text-xs font-bold text-gray-900 mb-2">약점 Top 3</h3>
          {weaknesses.length === 0 ? <p className="text-xs text-gray-400">데이터 부족</p> : (
            <ul className="space-y-1.5">
              {weaknesses.map((w) => (
                <li key={w.name} className="flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-800 truncate">{w.name}</div>
                    {w.category_name && <div className="text-[10px] text-gray-400">{w.category_name}</div>}
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className="font-bold tabular-nums text-red-500">{w.rate}%</span>
                    <div className="text-[10px] text-gray-400">오답 {w.wrong}회</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-gray-100 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Award className="h-3.5 w-3.5" style={{ color: BLUE }} />
            <h3 className="text-xs font-bold text-gray-900">이 기간의 성취</h3>
          </div>
          {achievements.length === 0 ? (
            <p className="text-xs text-gray-400">다음 기간에 성취를 쌓아가요</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {achievements.map((a, i) => (
                <span key={i} className="text-[10px] font-medium px-2 py-1 rounded-full"
                  style={{ background: '#EBF3FF', color: BLUE }}>
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 오답 문항 — 반 정답률 기준 분류 */}
      {wrongItems.length > 0 && (() => {
        const qAcc = classContext?.questionAccuracy ?? {}
        const classify = (w: WrongItem): 'solo' | 'hard' | 'common' => {
          const acc = qAcc[w.exam_question_id]
          if (!acc || acc.total === 0) return 'common'
          const rate = (acc.correct / acc.total) * 100
          if (rate >= 70) return 'solo'   // 반은 잘 맞췄는데 나만 틀림
          if (rate < 50) return 'hard'    // 반 전체가 어려웠던 문항
          return 'common'
        }
        const weakTagNames = new Set(weaknesses.map((w) => w.name))
        const fromWeak = weakTagNames.size > 0
          ? wrongItems.filter((w) => w.tags.some((t) => weakTagNames.has(t)))
          : wrongItems
        const displayed = (fromWeak.length > 0 ? fromWeak : wrongItems)
          .sort((a, b) => b.week_number - a.week_number)
          .slice(0, 5)
          .map((w) => ({ ...w, kind: classify(w) }))

        const WrongTable = ({ items }: { items: typeof displayed }) => (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-10">주차</th>
                <th className="px-3 py-2 text-left font-medium w-12">유형</th>
                <th className="px-3 py-2 text-left font-medium">문항 내용</th>
                <th className="px-3 py-2 text-center font-medium w-14">내 답안</th>
                <th className="px-3 py-2 text-center font-medium w-14">정답</th>
                {Object.keys(qAcc).length > 0 && <th className="px-3 py-2 text-center font-medium w-14">반 정답률</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((w) => {
                const acc = qAcc[w.exam_question_id]
                const classRate = acc && acc.total > 0 ? Math.round((acc.correct / acc.total) * 100) : null
                return (
                  <tr key={w.answer_id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-500">{w.week_number}주</td>
                    <td className="px-3 py-2">
                      <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                        {w.exam_type === 'reading' ? '독해' : w.exam_type === 'vocab' ? '어휘' : '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      <div className="truncate max-w-[180px]">{w.question_text ?? `${w.question_number}번`}</div>
                      {w.tags.length > 0 && (
                        <div className="text-[10px] text-gray-400 mt-0.5 truncate">
                          {w.tags.slice(0, 2).join(', ')}{w.tags.length > 2 && ` +${w.tags.length - 2}`}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-medium text-red-500">{w.my_answer}</td>
                    <td className="px-3 py-2 text-center font-medium" style={{ color: BLUE }}>{w.correct_answer}</td>
                    {Object.keys(qAcc).length > 0 && (
                      <td className="px-3 py-2 text-center text-[10px] tabular-nums text-gray-500">
                        {classRate !== null ? `${classRate}%` : '-'}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )

        const soloItems = displayed.filter((w) => w.kind === 'solo')
        const hardItems = displayed.filter((w) => w.kind === 'hard')
        const commonItems = displayed.filter((w) => w.kind === 'common')
        const hasClassData = Object.keys(qAcc).length > 0

        return (
          <section className="mt-4">
            <h2 className="text-sm font-bold text-gray-900 mb-2">오답 문항 분석</h2>
            {hasClassData ? (
              <div className="space-y-3">
                {soloItems.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-red-100">
                    <div className="px-3 py-2 bg-red-50 flex items-center gap-2">
                      <span className="text-[10px] font-bold text-red-600 px-1.5 py-0.5 rounded bg-red-100">나만 틀린 문항</span>
                      <span className="text-[10px] text-red-400">반 정답률 70% 이상 — 개인 집중 학습 필요</span>
                    </div>
                    <WrongTable items={soloItems} />
                  </div>
                )}
                {hardItems.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-amber-100">
                    <div className="px-3 py-2 bg-amber-50 flex items-center gap-2">
                      <span className="text-[10px] font-bold text-amber-700 px-1.5 py-0.5 rounded bg-amber-100">반 전체 어려운 문항</span>
                      <span className="text-[10px] text-amber-500">반 정답률 50% 미만 — 수업에서 함께 다룰 예정</span>
                    </div>
                    <WrongTable items={hardItems} />
                  </div>
                )}
                {commonItems.length > 0 && (
                  <div className="rounded-xl overflow-hidden border border-gray-100">
                    <div className="px-3 py-2 bg-gray-50">
                      <span className="text-[10px] font-semibold text-gray-500">기타 오답</span>
                    </div>
                    <WrongTable items={commonItems} />
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <WrongTable items={displayed} />
              </div>
            )}
          </section>
        )
      })()}

      {/* 한 줄 요약 */}
      {card.summary_text && (
        <section className="mt-4 rounded-xl p-3.5" style={{ background: 'linear-gradient(135deg, #EBF3FF 0%, #FFFFFF 100%)' }}>
          <p className="text-sm leading-relaxed text-gray-800">{card.summary_text}</p>
        </section>
      )}

      {/* 선생님 코멘트 */}
      {card.teacher_comment && (
        <section className="mt-3 rounded-xl border border-gray-100 p-4">
          <h3 className="text-xs font-bold mb-1.5" style={{ color: BLUE }}>담당 강사 코멘트</h3>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{card.teacher_comment}</p>
        </section>
      )}

      {/* 다음 기간 목표 */}
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

      {/* 푸터 — 서명 2인 */}
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
