'use client'

import { Award, Minus, Square, BookOpen, BookText, ClipboardCheck } from 'lucide-react'
import type { ReportCard, ReportMetrics, PeriodComparison, ClassContext, AcademyProfile, WeekRow } from '@/lib/report-card'
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
            <h1 className="text-xl font-extrabold tracking-tight">{academy.name ?? '학원 정보 설정 필요'}</h1>
            {academy.english_name && (
              <p className="text-xs text-gray-500 mt-0.5">
                {academy.english_name}{academy.address ? ` · ${academy.address}` : ''}
              </p>
            )}
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
