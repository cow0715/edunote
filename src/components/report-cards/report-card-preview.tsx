'use client'

import { BookOpen, BookText, ClipboardCheck, TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown, Award, Square } from 'lucide-react'
import type { ReportCard, ReportMetrics, PeriodComparison, WeekRow } from '@/lib/report-card'

interface Props {
  student: { id: string; name: string; school: string | null; grade: string | null }
  card: ReportCard
  metrics: ReportMetrics
  previous: PeriodComparison | null
}

const BLUE = '#2463EB'

function reportNumber(cardId: string, generatedAt: string): string {
  const d = new Date(generatedAt)
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `RC-${yymmdd}-${cardId.slice(0, 6).toUpperCase()}`
}

function DiffBadge({ current, previous }: { current: number | null; previous: number | null | undefined }) {
  if (current === null || previous === null || previous === undefined) return null
  const diff = current - previous
  if (diff === 0) return <span className="text-[10px] text-gray-400">―</span>
  const up = diff > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(diff)}
    </span>
  )
}

function Sparkline({ values, color = BLUE }: { values: (number | null)[]; color?: string }) {
  const nums = values.map((v) => (v === null ? null : Math.max(0, Math.min(100, v))))
  const validIdx = nums.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0)
  if (validIdx.length < 1) {
    return <div className="h-7 flex items-center text-[10px] text-gray-300">기록 없음</div>
  }
  const w = 100
  const h = 28
  const n = nums.length
  const step = n > 1 ? w / (n - 1) : 0
  const points: { x: number; y: number; v: number }[] = []
  nums.forEach((v, i) => {
    if (v === null) return
    const x = n > 1 ? i * step : w / 2
    const y = h - (v / 100) * (h - 4) - 2
    points.push({ x, y, v })
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaPath = points.length > 1
    ? `${path} L ${points[points.length - 1].x.toFixed(1)} ${h} L ${points[0].x.toFixed(1)} ${h} Z`
    : null
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full h-7" preserveAspectRatio="none">
      {areaPath && <path d={areaPath} fill={color} opacity="0.08" />}
      {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="1.5" fill={color} />
      ))}
    </svg>
  )
}

function DomainCard({ icon: Icon, title, rate, prev, correct, total, scoredWeeks, totalWeeks, values }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  rate: number | null
  prev: number | null | undefined
  correct: number
  total: number
  scoredWeeks: number
  totalWeeks: number
  values: (number | null)[]
}) {
  return (
    <div className="rounded-2xl bg-white p-3.5 shadow-[0_4px_20px_rgba(0,75,198,0.04)] border border-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-500">
          <Icon className="h-4 w-4" />
          <span className="text-xs font-medium">{title}</span>
        </div>
        <DiffBadge current={rate} previous={prev} />
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-3xl font-extrabold text-gray-900 tabular-nums">{rate ?? '-'}</span>
        {rate !== null && <span className="text-sm font-medium text-gray-400">%</span>}
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-400">
        <span className="tabular-nums">{total > 0 ? `${correct} / ${total}` : '기록 없음'}</span>
        <span>참여 {scoredWeeks}/{totalWeeks}주</span>
      </div>
      <Sparkline values={values} />
    </div>
  )
}

function AttendanceBar({ present, late, absent, total }: { present: number; late: number; absent: number; total: number }) {
  if (total === 0) return <p className="text-[10px] text-gray-400">출석 기록 없음</p>
  const pctP = (present / total) * 100
  const pctL = (late / total) * 100
  const pctA = (absent / total) * 100
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div style={{ width: `${pctP}%`, background: BLUE }} />
        <div style={{ width: `${pctL}%`, background: '#F59E0B' }} />
        <div style={{ width: `${pctA}%`, background: '#EF4444' }} />
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: BLUE }} />출석 {present}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-500" />지각 {late}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />결석 {absent}</span>
      </div>
    </div>
  )
}

export function ReportCardPreview({ student, card, metrics, previous }: Props) {
  const {
    weekRows, avgReading, avgVocab, avgHomework, overallAvg,
    attendancePresent, attendanceLate, attendanceAbsent, attendanceTotal,
    strengths, weaknesses, totalQuestions, totalCorrect, achievements,
  } = metrics

  const totalWeeks = weekRows.length

  const readingCorrect = weekRows.reduce((s, r) => s + (r.reading_correct ?? 0), 0)
  const readingTotal = weekRows.reduce((s, r) => s + r.reading_total, 0)
  const readingScoredWeeks = weekRows.filter((r) => r.reading_rate !== null).length

  const vocabCorrect = weekRows.reduce((s, r) => s + (r.vocab_correct ?? 0), 0)
  const vocabTotal = weekRows.reduce((s, r) => s + r.vocab_total, 0)
  const vocabScoredWeeks = weekRows.filter((r) => r.vocab_rate !== null).length

  const homeworkDone = weekRows.reduce((s, r) => s + (r.homework_done ?? 0), 0)
  const homeworkTotal = weekRows.reduce((s, r) => s + r.homework_total, 0)
  const homeworkScoredWeeks = weekRows.filter((r) => r.homework_rate !== null).length

  const readingSeries = weekRows.map((r: WeekRow) => r.reading_rate)
  const vocabSeries = weekRows.map((r: WeekRow) => r.vocab_rate)
  const homeworkSeries = weekRows.map((r: WeekRow) => r.homework_rate)

  const focusItems = (card.next_focus ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <div
      className="mx-auto bg-white text-gray-900"
      style={{
        fontFamily: "'Plus Jakarta Sans', 'Pretendard', system-ui, sans-serif",
        maxWidth: '210mm',
        minHeight: '297mm',
        padding: '24px',
      }}
    >
      {/* 헤더 */}
      <header className="pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium" style={{ color: BLUE }}>EduNote 학습 성적표</p>
            <h1 className="text-2xl font-extrabold mt-1">{card.period_label}</h1>
            <p className="text-[10px] text-gray-400 mt-0.5">
              발급번호 {reportNumber(card.id, card.generated_at)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">{student.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {[student.school, student.grade].filter(Boolean).join(' · ') || '-'}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {card.period_start} ~ {card.period_end}
            </p>
          </div>
        </div>
      </header>

      {/* 종합 등급 + 한줄 요약 */}
      <section className="mt-5 rounded-2xl overflow-hidden" style={{ background: `linear-gradient(135deg, ${BLUE} 0%, #4F86F7 100%)` }}>
        <div className="p-5 text-white">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs opacity-80">종합 등급</p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-4xl font-extrabold">{card.overall_grade ?? '-'}</p>
                <p className="text-sm opacity-80">평균 {overallAvg ?? '-'}%</p>
                {previous && (
                  <span className="text-xs opacity-80">
                    ({previous.label} {previous.overallAvg ?? '-'}%)
                  </span>
                )}
              </div>
            </div>
            <div className="text-right text-xs opacity-90">
              <p>총 문항 {totalCorrect}/{totalQuestions}</p>
              <p className="mt-0.5">채점 주차 {totalWeeks}주</p>
            </div>
          </div>
          {card.summary_text && (
            <p className="mt-3 text-sm leading-relaxed opacity-95">{card.summary_text}</p>
          )}
        </div>
      </section>

      {/* 영역별 3카드 + 스파크라인 */}
      <section className="mt-4 grid grid-cols-3 gap-3">
        <DomainCard
          icon={BookOpen} title="Reading"
          rate={avgReading} prev={previous?.avgReading}
          correct={readingCorrect} total={readingTotal}
          scoredWeeks={readingScoredWeeks} totalWeeks={totalWeeks}
          values={readingSeries}
        />
        <DomainCard
          icon={BookText} title="Vocab"
          rate={avgVocab} prev={previous?.avgVocab}
          correct={vocabCorrect} total={vocabTotal}
          scoredWeeks={vocabScoredWeeks} totalWeeks={totalWeeks}
          values={vocabSeries}
        />
        <DomainCard
          icon={ClipboardCheck} title="Homework"
          rate={avgHomework} prev={previous?.avgHomework}
          correct={homeworkDone} total={homeworkTotal}
          scoredWeeks={homeworkScoredWeeks} totalWeeks={totalWeeks}
          values={homeworkSeries}
        />
      </section>

      {/* 강점 / 약점 */}
      {(strengths.length > 0 || weaknesses.length > 0) && (
        <section className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3.5 w-3.5" style={{ color: BLUE }} />
              <h3 className="text-xs font-bold text-gray-900">강점 Top 3</h3>
            </div>
            {strengths.length === 0 ? (
              <p className="text-xs text-gray-400">데이터 부족</p>
            ) : (
              <ul className="space-y-1.5">
                {strengths.map((s) => (
                  <li key={s.name} className="flex items-center justify-between text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 truncate">{s.name}</div>
                      {s.category_name && (
                        <div className="text-[10px] text-gray-400">{s.category_name}</div>
                      )}
                    </div>
                    <span className="font-bold tabular-nums shrink-0 ml-2" style={{ color: BLUE }}>{s.rate}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
              <h3 className="text-xs font-bold text-gray-900">약점 Top 3 (자주 틀린 유형)</h3>
            </div>
            {weaknesses.length === 0 ? (
              <p className="text-xs text-gray-400">데이터 부족</p>
            ) : (
              <ul className="space-y-1.5">
                {weaknesses.map((w) => (
                  <li key={w.name} className="flex items-center justify-between text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 truncate">{w.name}</div>
                      {w.category_name && (
                        <div className="text-[10px] text-gray-400">{w.category_name}</div>
                      )}
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
        </section>
      )}

      {/* 출석 + 성취 배지 */}
      <section className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-100 p-3">
          <h3 className="text-xs font-bold text-gray-900 mb-2">출석</h3>
          <AttendanceBar
            present={attendancePresent}
            late={attendanceLate}
            absent={attendanceAbsent}
            total={attendanceTotal}
          />
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
                <span
                  key={i}
                  className="text-[10px] font-medium px-2 py-1 rounded-full"
                  style={{ background: '#EBF3FF', color: BLUE }}
                >
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 선생님 코멘트 + 다음 기간 목표 */}
      <section className="mt-4 grid grid-cols-1 gap-3">
        {card.teacher_comment && (
          <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg, #EBF3FF 0%, #FFFFFF 100%)' }}>
            <h3 className="text-xs font-bold mb-1.5" style={{ color: BLUE }}>선생님 코멘트</h3>
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{card.teacher_comment}</p>
          </div>
        )}
        {focusItems.length > 0 && (
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-bold text-gray-900 mb-2">다음 기간 학습 목표</h3>
            <ul className="space-y-1.5">
              {focusItems.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                  <Square className="h-3.5 w-3.5 mt-0.5 text-gray-300 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 데이터가 전혀 없을 때 */}
      {weekRows.length === 0 && (
        <section className="mt-8 rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <Minus className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-400">이 기간에 채점된 주차 데이터가 없습니다</p>
        </section>
      )}

      {/* 푸터 — 서명 영역 */}
      <footer className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex items-end justify-between">
          <div className="text-[10px] text-gray-400">
            <p>EduNote · 학습 성적표</p>
            <p className="mt-0.5">발급일 {new Date(card.generated_at).toLocaleDateString('ko-KR')}</p>
          </div>
          <div className="text-right">
            <div className="w-32 h-10 border-b border-gray-300" />
            <p className="text-[10px] text-gray-400 mt-1">담당 강사 서명</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
