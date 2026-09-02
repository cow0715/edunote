'use client'

import dynamic from 'next/dynamic'
import { BookOpen, BookText, ClipboardCheck, RotateCcw } from 'lucide-react'
import { Card, EmptyState, SwipeChartCard } from '../share-components'
import { ShareModel } from '../use-share-model'
import { ATT_LABEL, ATT_STYLE, fmtShortDate, getWeekLabel, scoreColor } from '../share-utils'

const ScoreTrendChart = dynamic(
  () => import('@/components/share/score-trend-chart').then((m) => m.ScoreTrendChart),
  { ssr: false }
)

/** 반 평균 대비 차이 */
function ClassDiff({ mine, classAvg }: { mine: number | null; classAvg: number | null | undefined }) {
  if (classAvg === null || classAvg === undefined || mine === null) return null
  const diff = mine - classAvg
  return (
    <span className={`ml-1 text-[10px] font-medium ${
      diff > 0 ? 'text-emerald-500 dark:text-emerald-400' : diff < 0 ? 'text-rose-400' : 'text-gray-400'
    }`}>
      반 평균 {diff > 0 ? '+' : ''}{diff}%
    </span>
  )
}

export function ScoreTab({
  model,
  isDark,
  onOpenWrongNoteWeek,
}: {
  model: ShareModel
  isDark: boolean
  onOpenWrongNoteWeek: (kind: 'reading' | 'vocab', weekId: string) => void
}) {
  const {
    readingTrendData, vocabTrendData, visibleWeeks, scoreByWeek,
    classes, attByDate, classAverages, weekRate, weekScores,
  } = model

  return (
    <>
      {readingTrendData.length >= 1 && (
        <SwipeChartCard
          id="section-reading-chart"
          title="시험 점수 추이"
          subtitle="진단평가 정답률 (%) · 점선은 반 평균"
          itemCount={readingTrendData.length}
          scrollBody={false}
        >
          <ScoreTrendChart data={readingTrendData} isDark={isDark} series="reading" />
        </SwipeChartCard>
      )}

      {vocabTrendData.length >= 1 && (
        <SwipeChartCard
          id="section-vocab-chart"
          title="단어 점수 추이"
          subtitle="단어시험 정답률 (%) · 점선은 반 평균"
          itemCount={vocabTrendData.length}
          scrollBody={false}
        >
          <ScoreTrendChart data={vocabTrendData} isDark={isDark} series="vocab" />
        </SwipeChartCard>
      )}

      {visibleWeeks.length > 0 && (
        <Card title="회차별 성적" noPad info="주차별 시험·단어·과제 점수입니다. 시험/단어 칩을 클릭하면 해당 주차 오답노트로 바로 이동해요. 반 평균 대비 차이도 함께 표시됩니다.">
          <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
            {visibleWeeks.map((w) => {
              const score = scoreByWeek.get(w.id)
              const className = classes.find((c) => c.id === w.class_id)?.name ?? ''
              const attRecord = w.start_date ? attByDate.get(w.start_date) : undefined

              return (
                <div key={w.id} className="px-5 py-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {className} {getWeekLabel(w)}
                    </span>
                    {w.start_date && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">{fmtShortDate(w.start_date)}</span>
                    )}
                    {attRecord && (
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${ATT_STYLE[attRecord.status]}`}>
                        {ATT_LABEL[attRecord.status]}
                      </span>
                    )}
                  </div>

                  {score ? (
                    <>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {w.reading_total > 0 && score.reading_correct !== null && (
                          <button
                            type="button"
                            onClick={() => onOpenWrongNoteWeek('reading', w.id)}
                            className="flex items-center gap-1.5 rounded-lg bg-[#F5F6F8] px-2 py-1 text-xs transition-colors active:opacity-70 dark:bg-white/[0.05]"
                          >
                            <BookOpen className="h-3 w-3 text-[#8B95A1]" />
                            <span className="text-gray-600 dark:text-gray-300">시험</span>
                            <strong className={`ml-0.5 ${scoreColor(score.reading_correct ?? 0, w.reading_total)}`}>
                              {score.reading_correct ?? 0}/{w.reading_total}
                            </strong>
                            <ClassDiff mine={weekRate(score, w, 'reading')} classAvg={classAverages[w.id]?.readingRate} />
                          </button>
                        )}
                        {w.vocab_total > 0 && score.vocab_correct !== null && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenWrongNoteWeek('vocab', w.id)}
                              className="flex items-center gap-1.5 rounded-lg bg-[#F5F6F8] px-2 py-1 text-xs transition-colors active:opacity-70 dark:bg-white/[0.05]"
                            >
                              <BookText className="h-3 w-3 text-[#8B95A1]" />
                              <span className="text-gray-600 dark:text-gray-300">단어</span>
                              <strong className={`ml-0.5 ${scoreColor(score.vocab_correct, w.vocab_total)}`}>
                                {score.vocab_correct}/{w.vocab_total}
                              </strong>
                              <ClassDiff mine={weekRate(score, w, 'vocab')} classAvg={classAverages[w.id]?.vocabRate} />
                            </button>
                            {score.vocab_correct < w.vocab_total && score.vocab_retake_correct !== null && (
                              <span className="flex items-center gap-1 rounded-lg bg-[#F5F6F8] px-2 py-1 text-xs dark:bg-white/[0.05]">
                                <RotateCcw className="h-3 w-3 text-[#8B95A1]" />
                                <span className="text-gray-500 dark:text-gray-400">재시험</span>
                                <strong className={`ml-0.5 ${scoreColor(score.vocab_retake_correct, w.vocab_total - score.vocab_correct)}`}>
                                  {score.vocab_retake_correct}/{w.vocab_total - score.vocab_correct}
                                </strong>
                              </span>
                            )}
                          </div>
                        )}
                        {w.homework_total > 0 && score.homework_done !== null && (
                          <span className="flex items-center gap-1.5 rounded-lg bg-[#F5F6F8] px-2 py-1 text-xs dark:bg-white/[0.05]">
                            <ClipboardCheck className="h-3 w-3 text-[#8B95A1]" />
                            <span className="text-gray-600 dark:text-gray-300">과제</span>
                            <strong className={`ml-0.5 ${scoreColor(score.homework_done, w.homework_total)}`}>
                              {score.homework_done}/{w.homework_total}
                            </strong>
                          </span>
                        )}
                      </div>
                      {score.memo && (
                        <blockquote className="mt-3 border-l-2 border-[#2463EB]/40 pl-3 dark:border-[#3B82F6]/50">
                          <p className="text-sm leading-relaxed text-[#3F4650] dark:text-[#CBD5E1]">{score.memo}</p>
                          <footer className="mt-1 text-[12px] text-[#8B95A1]">선생님 코멘트</footer>
                        </blockquote>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">성적 미입력</p>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {weekScores.length === 0 && (
        <EmptyState>아직 시험 결과가 없습니다</EmptyState>
      )}
    </>
  )
}
