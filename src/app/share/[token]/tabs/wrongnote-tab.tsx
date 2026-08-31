'use client'

// 오답노트 탭.
//
// 설계 원칙 (이전 버전에서 고친 것):
//   · 상자 중첩 금지 — Card > 주차 섹션 > 구분선으로 나뉜 문항. 흰→회→흰→회 반복을 없앴다.
//   · 카드 문법 통일 — 독해·단어 모두 "문제 → 내 답 · 정답" 한 줄. 라벨을 위에 쌓지 않는다.
//   · 색 예산 — 정오(rose/emerald)에만 색을 쓴다. 주차 뱃지·유형칩·해설은 무채색.
//   · 들어오자마자 내용이 보이게 — 최신 주차는 부모가 자동으로 펼쳐 준다.
//   · 목록 탐색(검색·필터)은 단어장 탭이 담당한다. 여기서는 링크로 넘긴다.

import { LibraryBig } from 'lucide-react'
import { Card } from '../share-components'
import { ShareModel } from '../use-share-model'
import { SCROLL_OFFSET_CLASS, VocabStudyMode, fmtShortDate, getWeekLabel } from '../share-utils'
import { RetakeActionRow, WeekAccordionHeader, WrongAnswerCard, WrongVocabRow } from '../wrong-answer-card'

export type WrongNoteSubTab = 'reading' | 'vocab'

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white p-10 text-center text-sm text-[#8B95A1] shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:bg-[#1E293B] dark:text-[#94A3B8] dark:shadow-none">
      {children}
    </div>
  )
}

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
  /** 목록 탐색은 단어장 탭으로 넘긴다 (#6 역할 분리) */
  onOpenVocabList: (weekId: string | null, studyMode: VocabStudyMode) => void
  onStartRetake: (weekId: string) => void
}) {
  const { wrongNoteGroups, vocabWrongGroups, wrongNoteSummary, scoreByWeek } = model
  const { readingCount, vocabCount, retakeRemaining } = wrongNoteSummary

  const segments = [
    { id: 'reading' as const, label: '진단평가', count: readingCount },
    { id: 'vocab' as const, label: '단어', count: vocabCount },
  ]

  return (
    <>
      {/* 진단평가 / 단어 — 개수를 같이 보여줘 어디에 오답이 있는지 먼저 알린다 */}
      {/* role="tablist" 을 쓰려면 화살표 키 이동·roving tabindex·tabpanel 연결까지 있어야 한다.
          여기선 두 갈래 필터 토글이라 aria-pressed 로 충분하고, 반만 구현한 tab 의미론보다 정확하다. */}
      <div className="flex rounded-2xl bg-white p-1 shadow-[0_2px_12px_rgba(0,0,0,0.05)] dark:bg-[#1E293B] dark:shadow-none">
        {segments.map(({ id, label, count }) => {
          const active = subTab === id
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => onSubTabChange(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-all ${
                active
                  ? 'bg-[#2463EB] text-white shadow-sm dark:bg-[#3B82F6]'
                  : 'text-[#8B95A1] hover:text-[#1A1C1E] dark:text-[#94A3B8] dark:hover:text-white'
              }`}
            >
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-300'
              }`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* 재시험이 남아 있으면 한 줄로만 알린다 */}
      {retakeRemaining > 0 && (
        <button
          type="button"
          onClick={() => onOpenVocabList(null, 'retake_pending')}
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-left shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-colors hover:bg-blue-50/60 dark:bg-[#1E293B] dark:shadow-none dark:hover:bg-white/[0.06]"
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold text-[#1A1C1E] dark:text-[#F8FAFC]">
              재시험 {retakeRemaining}개 남음
            </span>
            <span className="mt-0.5 block text-xs text-[#8B95A1] dark:text-[#94A3B8]">
              단어장에서 남은 단어만 모아 볼 수 있어요
            </span>
          </span>
          <LibraryBig className="h-4 w-4 shrink-0 text-[#2463EB] dark:text-blue-400" />
        </button>
      )}

      {/* ── 진단평가 오답 ─────────────────────────────────────────── */}
      {subTab === 'reading' && (
        wrongNoteGroups.length === 0 ? (
          <EmptyCard>진단평가 오답 데이터가 없습니다</EmptyCard>
        ) : (
          <Card noPad>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
              {wrongNoteGroups.map(({ week, answers, className }) => {
                const isOpen = expandedReadingWeekIds.has(week.id)
                return (
                  <section key={week.id} id={`wrongnote-reading-${week.id}`} className={SCROLL_OFFSET_CLASS}>
                    <WeekAccordionHeader
                      title={`${className} ${getWeekLabel(week)}`.trim()}
                      date={week.start_date ? fmtShortDate(week.start_date) : null}
                      count={answers.length}
                      countLabel="문제"
                      isOpen={isOpen}
                      onToggle={() => onToggleReadingWeek(week.id)}
                    />
                    {isOpen && (
                      <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/[0.06] dark:border-white/[0.08]">
                        {answers.map((a) => (
                          <WrongAnswerCard key={a.id} answer={a} token={token} />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </Card>
        )
      )}

      {/* ── 단어 오답 ─────────────────────────────────────────────── */}
      {subTab === 'vocab' && (
        vocabWrongGroups.length === 0 ? (
          <EmptyCard>단어 오답 데이터가 없습니다</EmptyCard>
        ) : (
          <Card noPad>
            <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
              {vocabWrongGroups.map(({ week, answers, className }) => {
                const isOpen = expandedVocabWeekIds.has(week.id)
                const score = scoreByWeek.get(week.id)
                const showRetake = !!score && score.vocab_correct !== null && score.vocab_correct < week.vocab_total

                return (
                  <section key={week.id} id={`wrongnote-vocab-${week.id}`} className={SCROLL_OFFSET_CLASS}>
                    <WeekAccordionHeader
                      title={`${className} ${getWeekLabel(week)}`.trim()}
                      date={week.start_date ? fmtShortDate(week.start_date) : null}
                      count={answers.length}
                      countLabel="개"
                      isOpen={isOpen}
                      onToggle={() => onToggleVocabWeek(week.id)}
                    />
                    {isOpen && (
                      <div className="border-t border-gray-100 dark:border-white/[0.08]">
                        {showRetake && (
                          <RetakeActionRow
                            originalWrong={week.vocab_total - (score!.vocab_correct ?? 0)}
                            mastered={score!.vocab_retake_correct ?? 0}
                            started={score!.vocab_retake_correct !== null}
                            onStart={() => onStartRetake(week.id)}
                          />
                        )}
                        <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/[0.06] dark:border-white/[0.08]">
                          {answers.map((va) => (
                            <WrongVocabRow key={va.id} answer={va} />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenVocabList(week.id, 'all')}
                          className="flex w-full items-center justify-center gap-1.5 border-t border-gray-100 px-5 py-3 text-xs font-bold text-[#2463EB] transition-colors hover:bg-blue-50/60 dark:border-white/[0.08] dark:text-blue-400 dark:hover:bg-white/[0.04]"
                        >
                          <LibraryBig className="h-3.5 w-3.5" />
                          이 주차 단어장 전체 보기
                        </button>
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </Card>
        )
      )}
    </>
  )
}
