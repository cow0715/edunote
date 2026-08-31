'use client'

import { memo } from 'react'
import { VocabStudyItem } from './share-utils'
import { ExampleBox, WordRelationChips } from './share-word-parts'

/** 사전학습 단어장의 단어 카드 */
export const VocabStudyWordCard = memo(function VocabStudyWordCard({
  item,
  showWeekLabel,
}: {
  item: VocabStudyItem
  showWeekLabel?: boolean
}) {
  const { word, wrongAnswer, weekLabel } = item
  const isRetakeDone = wrongAnswer?.retake_is_correct === true
  const isRetakePending = !!wrongAnswer && !isRetakeDone

  return (
    // 375px 폭 실측 중앙값 240px (범위 143~329). 기존 120px 은 절반이라
    // 첫 스크롤에서 목록이 튀었다.
    <div className={`px-5 py-4 [content-visibility:auto] [contain-intrinsic-size:auto_240px] ${isRetakeDone ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-300 dark:text-gray-600">#{word.number}</span>
            <p className="break-words text-base font-black leading-tight text-[#1A1C1E] dark:text-[#F8FAFC]">
              {word.english_word}
            </p>
            {word.part_of_speech && (
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/[0.08] dark:text-gray-300">
                {word.part_of_speech}
              </span>
            )}
            {showWeekLabel && (
              <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-[#2463EB] dark:bg-blue-950/40 dark:text-blue-300">
                {weekLabel}
              </span>
            )}
            {word.passage_label && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-white/[0.08] dark:text-slate-300">
                지문 {word.passage_label}
              </span>
            )}
          </div>
          {word.correct_answer && (
            <p className="mt-1 text-sm font-semibold leading-relaxed text-gray-600 dark:text-gray-300">
              {word.correct_answer}
            </p>
          )}
        </div>

        {wrongAnswer && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            isRetakeDone
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
              : 'bg-rose-50 text-rose-500 dark:bg-rose-950/50 dark:text-rose-400'
          }`}>
            {isRetakeDone ? '재시험 완료' : isRetakePending ? '재시험 남음' : '오답'}
          </span>
        )}
      </div>

      {wrongAnswer && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs text-gray-400 dark:text-gray-500">내 답</span>
          <span className="text-sm text-rose-400 line-through dark:text-rose-500">
            {wrongAnswer.student_answer || '미작성'}
          </span>
        </div>
      )}

      <WordRelationChips word={word} className="mt-3" />

      {word.derivatives && (
        <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500 dark:bg-white/[0.05] dark:text-gray-300">
          <span className="mr-1 font-bold text-gray-400 dark:text-gray-500">파생/변형</span>
          {word.derivatives}
        </div>
      )}

      {word.example_sentence && (
        <ExampleBox sentence={word.example_sentence} translation={word.example_translation} className="mt-2" />
      )}
    </div>
  )
})
