'use client'

// 단어 탭의 단어 행.
// design_handoff_share_report/README.md "5. 단어": #N 회색 / 단어 15px 800 + 출제유형 배지
// / 뜻 13px / 유·반 칩. 배지는 전부 회색이고, 색은 오답 상태에만 쓴다.

import { memo } from 'react'
import { VocabStudyItem } from './share-utils'
import { ExampleBox, SHARE_WRONG_CLASS, WordRelationChips } from './share-word-parts'
import { T } from './share-tokens'

/** 시험지에 어떤 형태로 나왔는지 — 오답노트와 같은 라벨을 쓴다 */
const SOURCE_LABEL: Record<string, string> = {
  synonym: '유의어',
  antonym: '반의어',
  derivative: '파생어',
  example: '예문 빈칸',
  example_choice: '예문 선택',
}

const GRAY_BADGE = 'rounded-full bg-[#F2F4F6] px-1.5 py-0.5 text-[10px] font-bold text-[#6B7684]'

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

  // "반의어 · various" 처럼 출제 형태와 그때의 문제 단어를 같이 보여준다 —
  // 원본 단어만 보면 왜 이 뜻이 정답인지 설명이 안 된다.
  const sourceLabel = wrongAnswer?.test_source ? SOURCE_LABEL[wrongAnswer.test_source] : null
  const testWord = wrongAnswer?.test_word && wrongAnswer.test_word !== word.english_word
    ? wrongAnswer.test_word
    : null

  // 예문 유형은 정답이 단어 뜻이 아니라 문장에 들어갈 영어라서 example_answer 에 있다.
  // 둘 다 없으면 "→ -" 만 남으므로 정답 쪽을 통째로 생략한다.
  const correctText = word.correct_answer ?? wrongAnswer?.example_answer ?? null

  return (
    // 375px 폭 실측 중앙값 240px (범위 143~329). 너무 작게 잡으면 첫 스크롤에서 목록이 튄다.
    <div className={`px-[18px] py-3.5 [content-visibility:auto] [contain-intrinsic-size:auto_240px] ${isRetakeDone ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-[#B0B8C1] tabular-nums">#{word.number}</span>
            <p className="break-words text-[15px] font-extrabold leading-tight">{word.english_word}</p>
            {sourceLabel && (
              <span className={GRAY_BADGE}>{sourceLabel}{testWord ? ` · ${testWord}` : ''}</span>
            )}
            {word.part_of_speech && <span className={GRAY_BADGE}>{word.part_of_speech}</span>}
            {showWeekLabel && <span className={GRAY_BADGE}>{weekLabel}</span>}
            {word.passage_label && <span className={GRAY_BADGE}>지문 {word.passage_label}</span>}
          </div>
          {word.correct_answer && (
            <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#333D4B]">{word.correct_answer}</p>
          )}
        </div>

        {wrongAnswer && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={isRetakeDone
              ? { color: T.blue, background: T.blueBg }
              : isRetakePending
                ? { color: T.muted, background: T.box }
                : { color: T.red, background: T.redBg }}
          >
            {isRetakeDone ? '재시험 통과' : isRetakePending ? '재시험 대기' : '오답'}
          </span>
        )}
      </div>

      {wrongAnswer && (
        <p className="mt-1.5 text-[13px]">
          {wrongAnswer.student_answer
            ? <span className={SHARE_WRONG_CLASS}>{wrongAnswer.student_answer}</span>
            : <span className="text-[#B0B8C1]">(미작성)</span>}
          {correctText && (
            <>
              <span className="mx-1.5 text-[#B0B8C1]">→</span>
              <span className="font-semibold">{correctText}</span>
            </>
          )}
        </p>
      )}

      <WordRelationChips word={word} className="mt-2.5" />

      {word.derivatives && (
        <div className="mt-2 rounded-[12px] bg-white px-3 py-2 text-[12px] leading-relaxed text-[#4E5968]">
          <span className="mr-1 font-bold text-[#8B95A1]">파생/변형</span>
          {word.derivatives}
        </div>
      )}

      {word.example_sentence && (
        <ExampleBox sentence={word.example_sentence} translation={word.example_translation} className="mt-2" />
      )}
    </div>
  )
})
