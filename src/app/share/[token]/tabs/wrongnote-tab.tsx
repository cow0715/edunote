'use client'

// 오답 탭.
//
// design_handoff_share_report/README.md "4. 오답" 이 원본이다.
//   · 상단 세그먼트 "진단평가 N | 단어 N".
//   · 진단평가 최상단은 파랑 CTA(다시 풀기), 단어 최상단은 다크 CTA(재시험).
//   · 주차 아코디언 — 최신 주차는 부모가 자동으로 펼쳐 준다.
//   · 목록 탐색(검색·필터)은 단어 탭이 담당한다. 여기서는 링크로 넘긴다.

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, EmptyNote } from '../share-components'
import { PRESS, PRESS_STRONG, T } from '../share-tokens'
import { ShareModel } from '../use-share-model'
import { VocabStudyMode, fmtShortDate, getWeekLabel, groupAnswersByQuestion } from '../share-utils'
import { RetakeActionRow, ReviewActionRow, WeekAccordionHeader, WrongAnswerCard, WrongVocabRow } from '../wrong-answer-card'
import { ReadingReview, ReviewQuestion, buildReviewQuestions } from '../reading-review'

export type WrongNoteSubTab = 'reading' | 'vocab'

/** 예상 시간 — 한 문항 1분 (푸는 시간 + 해설 한 번 읽는 시간) */
const estimateMinutes = (count: number) => Math.max(1, count)

export function WrongNoteTab({
  token,
  model,
  subTab,
  onSubTabChange,
  expandedReadingWeekIds,
  onToggleReadingWeek,
  expandedVocabWeekIds,
  onToggleVocabWeek,
  onOpenVocabList,
  onStartRetake,
}: {
  token: string
  model: ShareModel
  subTab: WrongNoteSubTab
  onSubTabChange: (tab: WrongNoteSubTab) => void
  expandedReadingWeekIds: Set<string>
  onToggleReadingWeek: (weekId: string) => void
  expandedVocabWeekIds: Set<string>
  onToggleVocabWeek: (weekId: string) => void
  /** 목록 탐색은 단어 탭으로 넘긴다 */
  onOpenVocabList: (weekId: string | null, studyMode: VocabStudyMode) => void
  onStartRetake: (weekId: string) => void
}) {
  const { wrongNoteGroups, vocabWrongGroups, wrongNoteSummary, scoreByWeek, scoredWeeks, studentAnswers } = model
  const { readingCount, vocabCount, retakeRemaining } = wrongNoteSummary

  // 다시 풀 범위 — 주차 id 이거나, 전체를 뜻하는 'all'. null 이면 닫힘.
  // 단어 재시험이 회차 단위인 것과 맞췄다 (한 회차 분량이 학생이 앉은 자리에서 끝낼 크기다).
  const [reviewScope, setReviewScope] = useState<string | null>(null)

  // 다시 풀 수 있는 건 선지가 남은 객관식과 OX 뿐이다 (서술형은 고를 게 없다)
  const reviewByWeek = useMemo(() => {
    const map = new Map<string, ReviewQuestion[]>()
    for (const g of wrongNoteGroups) map.set(g.week.id, buildReviewQuestions(g.answers))
    return map
  }, [wrongNoteGroups])
  const allReviewQuestions = useMemo(() => [...reviewByWeek.values()].flat(), [reviewByWeek])
  const reviewQuestions = reviewScope === 'all'
    ? allReviewQuestions
    : reviewScope ? reviewByWeek.get(reviewScope) ?? [] : []

  const segments = [
    { id: 'reading' as const, label: '진단평가', count: readingCount },
    { id: 'vocab' as const, label: '단어', count: vocabCount },
  ]

  return (
    <>
      {/* 진단평가 / 단어 — 개수를 같이 보여줘 어디에 오답이 있는지 먼저 알린다.
          role="tablist" 을 쓰려면 화살표 키 이동·roving tabindex·tabpanel 연결까지 있어야 한다.
          여기선 두 갈래 필터 토글이라 aria-pressed 로 충분하고, 반만 구현한 tab 의미론보다 정확하다. */}
      <div className="flex rounded-[18px] bg-[#F2F4F6] p-1">
        {segments.map(({ id, label, count }) => {
          const active = subTab === id
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => onSubTabChange(id)}
              className={`${PRESS_STRONG} flex flex-1 items-center justify-center gap-1.5 rounded-[14px] py-2 text-[13px] font-extrabold transition-colors`}
              style={active ? { background: T.blue, color: '#FFFFFF' } : { color: T.body2 }}
            >
              {label}
              <span
                className="rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                style={active
                  ? { background: 'rgba(255,255,255,0.22)', color: '#FFFFFF' }
                  : { background: '#FFFFFF', color: T.muted }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── 진단평가 오답 ─────────────────────────────────────────── */}
      {subTab === 'reading' && (
        wrongNoteGroups.length === 0 ? (
          <ReadingEmpty scoredWeeks={scoredWeeks} studentAnswers={studentAnswers} />
        ) : (
          <>
            {allReviewQuestions.length > 0 ? (
              <CtaCard
                tone="blue"
                title={`${allReviewQuestions.length}문항 다시 풀기`}
                // 선지가 저장된 문항만 풀 수 있어서 오답 총계보다 적을 수 있다 — 그 사실을 힌트에 적는다
                hint={allReviewQuestions.length < readingCount
                  ? `약 ${estimateMinutes(allReviewQuestions.length)}분 · 객관식·OX 오답만`
                  : `약 ${estimateMinutes(allReviewQuestions.length)}분 · 해설 포함`}
                onClick={() => setReviewScope('all')}
              />
            ) : (
              // 선지가 저장된 객관식이 하나도 없으면 다시 풀 수 없다 — 목록으로만 보낸다
              <CtaCard
                tone="blue"
                title={`오답 ${readingCount}문항 보기`}
                hint={`약 ${estimateMinutes(readingCount)}분 · 해설 포함`}
                onClick={() => {
                  const first = wrongNoteGroups[0].week.id
                  if (!expandedReadingWeekIds.has(first)) onToggleReadingWeek(first)
                  document.getElementById(`wrongnote-reading-${first}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              />
            )}
            <Card noPad>
              <div className="divide-y divide-[#EEF1F4]">
                {wrongNoteGroups.map(({ week, answers, className }) => {
                  const isOpen = expandedReadingWeekIds.has(week.id)
                  return (
                    <section key={week.id} id={`wrongnote-reading-${week.id}`} className="scroll-mt-4">
                      <WeekAccordionHeader
                        title={`${className} ${getWeekLabel(week)}`.trim()}
                        date={week.start_date ? fmtShortDate(week.start_date) : null}
                        count={answers.length}
                        countLabel="문제"
                        isOpen={isOpen}
                        onToggle={() => onToggleReadingWeek(week.id)}
                      />
                      {isOpen && (
                        <div className="border-t border-[#EEF1F4]">
                          {(reviewByWeek.get(week.id)?.length ?? 0) > 0 && (
                            <ReviewActionRow
                              count={reviewByWeek.get(week.id)!.length}
                              onStart={() => setReviewScope(week.id)}
                            />
                          )}
                          <div className="divide-y divide-[#EEF1F4] border-t border-[#EEF1F4]">
                            {groupAnswersByQuestion(answers).map((group) => (
                              <WrongAnswerCard key={group[0].id} answers={group} token={token} />
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            </Card>
          </>
        )
      )}

      {/* ── 단어 오답 ─────────────────────────────────────────────── */}
      {subTab === 'vocab' && (
        vocabWrongGroups.length === 0 ? (
          <EmptyNote title="틀린 단어가 없어요" hint="이 기간엔 단어 오답 기록이 없습니다." />
        ) : (
          <>
            {retakeRemaining > 0 && (
              <CtaCard
                tone="dark"
                title={`재시험 ${retakeRemaining}개 남음`}
                hint="1분 20초 · 뜻 입력"
                onClick={() => onOpenVocabList(null, 'retake_pending')}
              />
            )}
            <Card noPad>
              <div className="divide-y divide-[#EEF1F4]">
                {vocabWrongGroups.map(({ week, answers, className }) => {
                  const isOpen = expandedVocabWeekIds.has(week.id)
                  const score = scoreByWeek.get(week.id)
                  const showRetake = !!score && score.vocab_correct !== null && score.vocab_correct < week.vocab_total

                  return (
                    <section key={week.id} id={`wrongnote-vocab-${week.id}`} className="scroll-mt-4">
                      <WeekAccordionHeader
                        title={`${className} ${getWeekLabel(week)}`.trim()}
                        date={week.start_date ? fmtShortDate(week.start_date) : null}
                        count={answers.length}
                        countLabel="개"
                        isOpen={isOpen}
                        onToggle={() => onToggleVocabWeek(week.id)}
                      />
                      {isOpen && (
                        <div className="border-t border-[#EEF1F4]">
                          {showRetake && (
                            <RetakeActionRow
                              originalWrong={week.vocab_total - (score!.vocab_correct ?? 0)}
                              mastered={score!.vocab_retake_correct ?? 0}
                              started={score!.vocab_retake_correct !== null}
                              onStart={() => onStartRetake(week.id)}
                            />
                          )}
                          <div className="divide-y divide-[#EEF1F4] border-t border-[#EEF1F4]">
                            {answers.map((va) => (
                              <WrongVocabRow key={va.id} answer={va} />
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenVocabList(week.id, 'all')}
                            className={`${PRESS} flex w-full items-center justify-center gap-1 border-t border-[#EEF1F4] px-5 py-3 text-[12px] font-bold text-[#3182F6]`}
                          >
                            이 주차 단어장 전체 보기
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            </Card>
          </>
        )
      )}

      {reviewScope && reviewQuestions.length > 0 && (
        <ReadingReview
          // 범위가 바뀌면 진행 상태를 처음부터 다시 잡는다
          key={reviewScope}
          questions={reviewQuestions}
          onClose={() => setReviewScope(null)}
          onGoWrongNote={() => setReviewScope(null)}
        />
      )}
    </>
  )
}

// ── 상단 CTA ───────────────────────────────────────────────────────────────
function CtaCard({ tone, title, hint, onClick }: {
  tone: 'blue' | 'dark'
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${PRESS_STRONG} flex w-full items-center gap-3 rounded-[20px] px-[22px] py-[18px] text-left`}
      style={{ background: tone === 'blue' ? T.blue : T.panel }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-extrabold text-white">{title}</span>
        <span className="mt-0.5 block text-[12px] text-white/70">{hint}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-white" />
    </button>
  )
}

// ── 진단평가 빈 상태 3종 ───────────────────────────────────────────────────
/**
 * "오답이 없다" 는 세 가지 뜻이 될 수 있고, 학부모에게는 전혀 다른 소식이다:
 *   시험 자체가 없었나 / 다 맞았나 / 점수만 기록되고 문항 데이터가 없나.
 * 한 문장으로 뭉치면 "기록이 안 들어왔다" 를 "잘했다" 로 오해한다.
 */
function ReadingEmpty({ scoredWeeks, studentAnswers }: {
  scoredWeeks: ShareModel['scoredWeeks']
  studentAnswers: ShareModel['studentAnswers']
}) {
  const hasExam = scoredWeeks.some((w) => w.reading_total > 0)
  if (!hasExam) {
    return <EmptyNote title="이 기간엔 진단평가가 없어요" hint="단어·과제만 진행 중이에요." />
  }
  const hasQuestionData = studentAnswers.some((a) => a.exam_question?.exam_type === 'reading')
  if (!hasQuestionData) {
    return <EmptyNote title="문항별 오답 기록이 없어요" hint="이 기간은 점수만 기록되어 있어요." />
  }
  return <EmptyNote title="진단평가 오답이 없어요" hint="시험 전 문항 정답이에요." />
}
