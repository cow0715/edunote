'use client'

// 분석 탭에서 유형(개념 태그)을 탭했을 때 열리는 오답 드로어.
// 카드는 오답 탭과 같은 WrongAnswerCard 를 쓴다 — 예전처럼 따로 그리지 않는다.
// 시트 규격(오버레이 rgba(25,31,40,.5) · 20px 라운드 · 핸들 36×4)은 기간 선택 시트와 같다.

import { X } from 'lucide-react'
import { PRESS } from './share-tokens'
import { StudentAnswer } from './share-types'
import { groupAnswersByQuestion } from './share-utils'
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
        className={`fixed inset-0 z-40 bg-[rgba(25,31,40,0.5)] transition-opacity duration-300 ${
          tag ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed bottom-0 left-1/2 z-50 flex max-h-[82vh] w-full max-w-[430px] -translate-x-1/2 flex-col rounded-t-[20px] bg-[#F9FAFB] text-[#191F28] transition-transform duration-300 ease-out ${
          tag ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-9 rounded-full bg-[#E5E8EB]" />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-[#E5E8EB] px-5 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-extrabold">{tag?.name} 오답노트</h3>
            <p className="text-[12px] text-[#8B95A1]">
              {tag?.weekId ? '이번 주차' : '전체 누적'} · 총 {answers.length}회 틀림
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className={`${PRESS} flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F2F4F6] text-[#6B7684]`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain pb-6">
          {answers.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-[#8B95A1]">오답 기록이 없어요</p>
          ) : (
            <div className="divide-y divide-[#EEF1F4]">
              {groupAnswersByQuestion(answers).map((group) => (
                <WrongAnswerCard
                  key={group[0].id}
                  answers={group}
                  token={token}
                  weekLabel={weekLabelByWeekId.get(group[0].exam_question?.week_id ?? '') ?? undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
