'use client'

// 분석 탭에서 유형(개념 태그)을 탭했을 때 열리는 오답 드로어.
// 카드는 오답노트 탭과 같은 WrongAnswerCard 를 쓴다 — 예전처럼 따로 그리지 않는다.

import { X } from 'lucide-react'
import { StudentAnswer } from './share-types'
import { WrongAnswerCard } from './wrong-answer-card'

export type DrawerTag = { id: string; name: string; weekId?: string | null }

export function TagDrawer({
  tag,
  answers,
  token,
  weekLabelByWeekId,
  onClose,
}: {
  tag: DrawerTag | null
  answers: StudentAnswer[]
  token: string
  weekLabelByWeekId: Map<string, string>
  onClose: () => void
}) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 dark:bg-black/60 ${
          tag ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed bottom-0 left-1/2 z-50 flex max-h-[82vh] w-full max-w-lg -translate-x-1/2 flex-col rounded-t-3xl bg-white transition-transform duration-300 ease-out dark:bg-[#1E293B] ${
          tag ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-gray-200 dark:bg-white/20" />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-white/[0.08]">
          <div className="min-w-0">
            <h3 className="truncate font-bold text-gray-900 dark:text-white">{tag?.name} 오답노트</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {tag?.weekId ? '이번 주차' : '전체 누적'} · 총 {answers.length}회 틀림
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.08] dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain pb-6">
          {answers.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">오답 데이터가 없습니다</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
              {answers.map((a) => (
                <WrongAnswerCard
                  key={a.id}
                  answer={a}
                  token={token}
                  weekLabel={weekLabelByWeekId.get(a.exam_question?.week_id ?? '') ?? undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
