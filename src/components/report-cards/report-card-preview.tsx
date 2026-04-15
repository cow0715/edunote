'use client'

import { BookOpen, BookText, ClipboardCheck, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { ReportCard, ReportMetrics, WrongItem } from '@/lib/report-card'

interface Props {
  student: { id: string; name: string; school: string | null; grade: string | null }
  card: ReportCard
  metrics: ReportMetrics
  highlightedWrongs: WrongItem[]
}

const BLUE = '#2463EB'

function RateBar({ value }: { value: number | null }) {
  if (value === null) return null
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: BLUE }}
      />
    </div>
  )
}

function DomainCard({ icon: Icon, title, rate, correct, total, hint }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  rate: number | null
  correct: number | null
  total: number | null
  hint?: string
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_4px_20px_rgba(0,75,198,0.04)] border border-gray-100">
      <div className="flex items-center gap-2 text-gray-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{title}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-extrabold text-gray-900 tabular-nums">
          {rate ?? '-'}
        </span>
        {rate !== null && <span className="text-sm font-medium text-gray-400">%</span>}
      </div>
      <p className="text-xs text-gray-400 mt-0.5">
        {correct !== null && total !== null && total > 0 ? `${correct} / ${total}` : hint ?? '데이터 없음'}
      </p>
      <RateBar value={rate} />
    </div>
  )
}

export function ReportCardPreview({ student, card, metrics, highlightedWrongs }: Props) {
  const {
    weekRows, avgReading, avgVocab, avgHomework, overallAvg,
    attendancePresent, attendanceTotal, strengths, weaknesses,
    totalQuestions, totalCorrect,
  } = metrics

  // 영역별 correct/total 합산
  const readingCorrect = weekRows.reduce((s, r) => s + (r.reading_correct ?? 0), 0)
  const readingTotal = weekRows.reduce((s, r) => s + r.reading_total, 0)
  const vocabCorrect = weekRows.reduce((s, r) => s + (r.vocab_correct ?? 0), 0)
  const vocabTotal = weekRows.reduce((s, r) => s + r.vocab_total, 0)
  const homeworkDone = weekRows.reduce((s, r) => s + (r.homework_done ?? 0), 0)
  const homeworkTotal = weekRows.reduce((s, r) => s + r.homework_total, 0)

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

      {/* 종합 평가 */}
      <section className="mt-5 grid grid-cols-3 gap-3">
        <div
          className="rounded-2xl p-4 text-white"
          style={{ background: `linear-gradient(135deg, ${BLUE} 0%, #4F86F7 100%)` }}
        >
          <p className="text-xs opacity-80">종합 등급</p>
          <p className="text-4xl font-extrabold mt-1">{card.overall_grade ?? '-'}</p>
          <p className="text-xs opacity-80 mt-1">
            평균 정답률 {overallAvg ?? '-'}%
          </p>
        </div>
        <div className="rounded-2xl bg-gray-50 p-4">
          <p className="text-xs text-gray-500">출석</p>
          <p className="text-3xl font-extrabold mt-1 text-gray-900">
            {attendancePresent}<span className="text-lg font-medium text-gray-400">/{attendanceTotal || '-'}</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {attendanceTotal > 0 ? `${Math.round((attendancePresent / attendanceTotal) * 100)}%` : '기록 없음'}
          </p>
        </div>
        <div className="rounded-2xl bg-gray-50 p-4">
          <p className="text-xs text-gray-500">총 문항</p>
          <p className="text-3xl font-extrabold mt-1 text-gray-900">
            {totalCorrect}<span className="text-lg font-medium text-gray-400">/{totalQuestions || '-'}</span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            풀어본 시험 문항 기준
          </p>
        </div>
      </section>

      {/* 영역별 */}
      <section className="mt-4 grid grid-cols-3 gap-3">
        <DomainCard icon={BookOpen} title="Reading" rate={avgReading} correct={readingCorrect} total={readingTotal} />
        <DomainCard icon={BookText} title="Vocab" rate={avgVocab} correct={vocabCorrect} total={vocabTotal} />
        <DomainCard icon={ClipboardCheck} title="Homework" rate={avgHomework} correct={homeworkDone} total={homeworkTotal} />
      </section>

      {/* 주차별 표 */}
      {weekRows.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">주차별 점수</h2>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">주차</th>
                  <th className="px-3 py-2 text-left font-medium">반</th>
                  <th className="px-3 py-2 text-left font-medium">날짜</th>
                  <th className="px-3 py-2 text-right font-medium">Reading</th>
                  <th className="px-3 py-2 text-right font-medium">Vocab</th>
                  <th className="px-3 py-2 text-right font-medium">Homework</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {weekRows.map((r) => (
                  <tr key={r.week_id}>
                    <td className="px-3 py-2 font-medium">{r.week_number}주</td>
                    <td className="px-3 py-2 text-gray-500">{r.class_name}</td>
                    <td className="px-3 py-2 text-gray-400">{r.start_date ?? '-'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.reading_rate !== null
                        ? <span className="font-medium">{r.reading_rate}%</span>
                        : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.vocab_rate !== null
                        ? <span className="font-medium">{r.vocab_rate}%</span>
                        : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.homework_rate !== null
                        ? <span className="font-medium">{r.homework_rate}%</span>
                        : <span className="text-gray-300">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 강점 / 약점 */}
      {(strengths.length > 0 || weaknesses.length > 0) && (
        <section className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3.5 w-3.5" style={{ color: BLUE }} />
              <h3 className="text-xs font-bold text-gray-900">강점 Top 3</h3>
            </div>
            {strengths.length === 0 ? (
              <p className="text-xs text-gray-400">데이터 부족</p>
            ) : (
              <ul className="space-y-1">
                {strengths.map((s) => (
                  <li key={s.name} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700">{s.name}</span>
                    <span className="font-bold tabular-nums" style={{ color: BLUE }}>{s.rate}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
              <h3 className="text-xs font-bold text-gray-900">약점 Bottom 3</h3>
            </div>
            {weaknesses.length === 0 ? (
              <p className="text-xs text-gray-400">데이터 부족</p>
            ) : (
              <ul className="space-y-1">
                {weaknesses.map((w) => (
                  <li key={w.name} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700">{w.name}</span>
                    <span className="font-bold tabular-nums text-red-500">{w.rate}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* 핵심 오답 */}
      {highlightedWrongs.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">핵심 오답</h2>
          <div className="space-y-2">
            {highlightedWrongs.map((w) => (
              <div key={w.answer_id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-900">
                      {w.week_number}주 · {w.exam_type === 'vocab' ? '단어' : '독해'} {w.question_number}{w.sub_label ?? ''}번
                    </p>
                    {w.question_text && (
                      <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{w.question_text}</p>
                    )}
                    {w.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {w.tags.map((t, i) => (
                          <span key={i} className="text-[10px] text-gray-400">#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-[10px] whitespace-nowrap">
                    <p className="text-gray-400">내 답: <span className="text-red-500 font-medium">{w.my_answer}</span></p>
                    <p className="text-gray-400 mt-0.5">정답: <span className="font-medium" style={{ color: BLUE }}>{w.correct_answer}</span></p>
                  </div>
                </div>
                {w.explanation && (
                  <p className="mt-1.5 text-[11px] text-gray-600 bg-gray-50 rounded-md px-2 py-1.5">
                    {w.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 선생님 코멘트 */}
      {(card.teacher_comment || card.next_focus) && (
        <section className="mt-5 grid grid-cols-1 gap-3">
          {card.teacher_comment && (
            <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg, #EBF3FF 0%, #FFFFFF 100%)' }}>
              <h3 className="text-xs font-bold mb-1.5" style={{ color: BLUE }}>선생님 코멘트</h3>
              <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">{card.teacher_comment}</p>
            </div>
          )}
          {card.next_focus && (
            <div className="rounded-xl border border-gray-100 p-4">
              <h3 className="text-xs font-bold text-gray-900 mb-1.5">다음 기간 학습 권장</h3>
              <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">{card.next_focus}</p>
            </div>
          )}
        </section>
      )}

      {/* 데이터가 전혀 없을 때 */}
      {weekRows.length === 0 && (
        <section className="mt-8 rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <Minus className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-400">이 기간에 채점된 주차 데이터가 없습니다</p>
        </section>
      )}

      {/* 푸터 */}
      <footer className="mt-8 pt-3 border-t border-gray-100 text-[10px] text-gray-400 flex justify-between">
        <span>EduNote · 학습 성적표</span>
        <span>발급일 {new Date(card.generated_at).toLocaleDateString('ko-KR')}</span>
      </footer>
    </div>
  )
}
