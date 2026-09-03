'use client'

// 진단평가 "다시 풀기" 플로우.
//
// design_handoff_share_report/README.md "다시풀기 플로우(진단평가)".
//
// 별도 라우트가 아니라 오답 탭 위에 덮는 전체화면이다 — 문항·선지·해설이 이미 화면에
// 로드돼 있어서, 라우트로 빼면 같은 데이터를 한 번 더 받아오게 된다.
// 채점도 서버에 보내지 않는다: 정답이 이미 손에 있고, 이 화면은 성적이 아니라 복습이다.

import { useRef, useState } from 'react'
import { FormattedQuestionText } from '@/components/grade/formatted-question-text'
import { oxChoiceLabels, parseOXAnswerKey } from '@/lib/ox-grading'
import { CIRCLE_NUM, StudentAnswer } from './share-types'
import { PRESS, PRESS_STRONG, T } from './share-tokens'
import { CountUp } from './share-ui'

export type ReviewQuestion = {
  id: string
  number: number
  /** 화면에 찍는 문항 표기 — 객관식 "18번", 밑줄 OX 는 지문 기호와 맞춘 "①" */
  numberLabel: string
  typeName: string | null
  passage: string | null
  stem: string
  choices: string[]
  /** 선지 앞 기호. 없으면 ①②③ 을 쓴다 (OX 는 T/F · O/X) */
  markers?: string[]
  /** 1-based */
  correct: number
  /** 시험 때 고른 선지 (1-based). 미작성이면 null */
  mine: number | null
  explanation: string | null
  /** OX 의 수정어처럼 정답 옆에 덧붙일 것 */
  answerNote?: string | null
}

/** 선지 기호 — OX 는 T/F, 객관식은 ①②③ */
const markerOf = (q: ReviewQuestion, index: number) =>
  q.markers?.[index] ?? CIRCLE_NUM[index] ?? String(index + 1)

/**
 * 오답 중 "다시 풀 수 있는" 것만 고른다.
 *
 * 선지가 저장돼 있고 정답 번호가 있는 객관식만 가능하다. 서술형·OX·선지 미파싱 문항은
 * 화면에 고를 게 없어서 제외한다 — CTA 개수도 이 결과로 센다.
 */
export function buildReviewQuestions(answers: StudentAnswer[]): ReviewQuestion[] {
  return answers
    .filter((a) => !a.is_correct && a.exam_question?.exam_type === 'reading')
    .map((a): ReviewQuestion | null => {
      const q = a.exam_question!
      // 밑줄 OX 는 question_number 가 곧 지문의 밑줄 번호다(sub_label 없음).
      // 지문에 ①②③ 로 찍혀 있으므로 같은 기호로 불러야 어느 밑줄인지 알 수 있다.
      const isUnderlineOX = q.question_style === 'ox' && !q.sub_label
      const base = {
        id: a.id,
        number: q.question_number,
        numberLabel: isUnderlineOX
          ? CIRCLE_NUM[q.question_number - 1] ?? `${q.question_number}번`
          : `${q.question_number}번${q.sub_label ?? ''}`,
        typeName: q.exam_question_tag.find((t) => t.concept_tag)?.concept_tag?.name ?? null,
        passage: q.passage?.trim() || null,
        stem: q.question_stem?.trim() || q.question_text?.trim() || `${q.question_number}번`,
        explanation: q.explanation?.trim() || null,
      }

      // OX 는 선지가 저장돼 있지 않아도 정답키에서 두 선택지를 만들 수 있다.
      // 학생이 고른 쪽은 student_answer 가 아니라 ox_selection 에 있다.
      if (q.question_style === 'ox') {
        const key = parseOXAnswerKey(q.correct_answer_text)
        if (!key) return null
        const { yes, no } = oxChoiceLabels(key.notation)
        return {
          ...base,
          choices: ['맞는 문장', '틀린 문장'],
          markers: [yes, no],
          correct: key.verdict === 'O' ? 1 : 2,
          mine: a.ox_selection === 'O' ? 1 : a.ox_selection === 'X' ? 2 : null,
          // 이 화면은 O/X 판정만 묻는다. 수정어까지 요구하지 않는 대신 정답 옆에 적어준다.
          answerNote: key.corrections.length > 0 ? `수정 ${key.corrections.join(' / ')}` : null,
        }
      }

      const choices = q.choices ?? []
      if (q.question_style !== 'objective' || q.correct_answer === null || choices.length < 2) return null
      return {
        ...base,
        choices,
        correct: q.correct_answer,
        mine: a.student_answer,
      }
    })
    .filter((q): q is ReviewQuestion => q !== null)
    .sort((a, b) => a.number - b.number)
}

export function ReadingReview({ questions, onClose, onGoWrongNote }: {
  questions: ReviewQuestion[]
  onClose: () => void
  onGoWrongNote: () => void
}) {
  const [queue, setQueue] = useState(questions)
  const [qi, setQi] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<{ id: string; correct: boolean }[]>([])
  const scrollerRef = useRef<HTMLDivElement>(null)

  const question = queue[qi]
  const done = qi >= queue.length



  if (done) {
    const correctCount = results.filter((r) => r.correct).length
    const wrongIds = new Set(results.filter((r) => !r.correct).map((r) => r.id))
    const rate = results.length > 0 ? Math.round((correctCount / results.length) * 100) : 0

    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-[56px] font-black tabular-nums" style={{ color: T.blue }}>
            <CountUp value={rate} suffix="%" />
          </p>
          <p className="mt-2 text-[15px] font-bold text-[#4E5968] tabular-nums">
            {results.length}문항 중 {correctCount}개 정답
          </p>
        </div>
        <div className="flex gap-2 px-4 pb-8">
          <PillButton label="오답노트로" onClick={onGoWrongNote} />
          {wrongIds.size > 0 && (
            <PillButton
              primary
              label={`틀린 것만 다시 (${wrongIds.size})`}
              onClick={() => {
                setQueue(queue.filter((q) => wrongIds.has(q.id)))
                setQi(0)
                setSelected(null)
                setRevealed(false)
                setResults([])
              }}
            />
          )}
        </div>
      </Screen>
    )
  }

  const isCorrect = selected === question.correct
  const progress = ((qi + (revealed ? 1 : 0)) / queue.length) * 100

  const onPrimary = () => {
    if (!revealed) {
      if (selected === null) return
      setRevealed(true)
      setResults((prev) => [...prev, { id: question.id, correct: selected === question.correct }])
      return
    }
    setQi((i) => i + 1)
    setSelected(null)
    setRevealed(false)
    // 다음 문항은 지문 맨 위부터 읽어야 한다
    scrollerRef.current?.scrollTo({ top: 0 })
  }

  return (
    <Screen>
      {/* 헤더 + 진행바 */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button type="button" onClick={onClose} className={`${PRESS} text-[13px] font-bold text-[#4E5968]`}>
            ← 나가기
          </button>
          {question.typeName && (
            <span className="min-w-0 flex-1 truncate text-center text-[12px] font-bold text-[#8B95A1]">
              {question.typeName}
            </span>
          )}
          <span className="ml-auto text-[13px] font-extrabold tabular-nums">
            {qi + 1} <span className="text-[#B0B8C1]">/ {queue.length}</span>
          </span>
        </div>
        <div className="h-1 bg-[#F2F4F6]">
          <div
            className="h-full transition-[width] duration-300"
            style={{ width: `${progress}%`, background: T.blue }}
          />
        </div>
      </div>

      {/* 지문 + 선지 */}
      <div ref={scrollerRef} className="relative flex-1 overflow-y-auto px-4 pt-4 pb-6">
        {question.passage && (
          <div className="mb-3 rounded-[16px] bg-[#F9FAFB] px-4 py-3.5">
            <FormattedQuestionText
              text={question.passage}
              className="text-[13px] leading-relaxed text-justify text-[#4E5968]"
            />
          </div>
        )}

        <p className="mb-1.5 text-[12px] font-bold text-[#3182F6]">{question.numberLabel}</p>
        <FormattedQuestionText
          text={question.stem}
          className="mb-4 text-[15px] font-bold leading-relaxed text-[#191F28]"
        />

        <div className="flex flex-col gap-2">
          {question.choices.map((choice, index) => {
            const number = index + 1
            const picked = selected === number
            const isAnswer = number === question.correct
            const showAnswer = revealed && isAnswer
            const showWrong = revealed && picked && !isAnswer

            return (
              <button
                key={number}
                type="button"
                disabled={revealed}
                onClick={() => setSelected(number)}
                className={`${PRESS_STRONG} flex items-start gap-2.5 rounded-[16px] border-2 px-4 py-3 text-left transition-colors`}
                style={{
                  borderColor: showAnswer ? T.blue : showWrong ? T.red : picked ? T.blue : 'transparent',
                  background: showAnswer ? T.blueBg : showWrong ? T.redBg : '#FFFFFF',
                  // 정답 확인 순간에만 튀거나 흔들린다 — 어떤 선지였는지 몸으로 기억하게
                  animation: showAnswer
                    ? 'share-pop .35s ease both'
                    : showWrong ? 'share-shake .4s ease both' : undefined,
                }}
              >
                <span
                  className="text-[14px] font-extrabold"
                  style={{ color: showAnswer ? T.blue : showWrong ? T.red : picked ? T.blue : T.disabled }}
                >
                  {markerOf(question, index)}
                </span>
                <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-[#191F28]">{choice}</span>
              </button>
            )
          })}
        </div>

      </div>

      {/* 피드백 + 하단 버튼 — 지문이 길어도 정답·해설이 늘 보이도록 스크롤 밖에 둔다 */}
      <div className="shrink-0 px-4 pb-8">
        {revealed && (
          <div
            className="mb-3 rounded-[16px] px-4 py-3.5"
            style={{ background: isCorrect ? T.blueBg : T.redBg }}
            role="status"
          >
            <p className="text-[14px] font-extrabold" style={{ color: isCorrect ? T.blue : T.red }}>
              {isCorrect ? '정답이에요' : `아쉬워요 · 정답은 ${markerOf(question, question.correct - 1)}`}
              {question.answerNote && (
                <span className="ml-1.5 text-[12px] font-bold text-[#4E5968]">{question.answerNote}</span>
              )}
            </p>
            {question.explanation && (
              <p className="mt-1.5 max-h-32 overflow-y-auto text-[12.5px] leading-relaxed text-[#4E5968]">
                {question.explanation}
              </p>
            )}
            {question.mine !== null && question.mine !== selected && (
              <p className="mt-1.5 text-[11px] text-[#8B95A1]">
                시험 때 고른 답 {markerOf(question, question.mine - 1)}
              </p>
            )}
          </div>
        )}
        <PillButton
          primary
          disabled={!revealed && selected === null}
          label={!revealed ? '확인' : qi === queue.length - 1 ? '결과 보기' : '다음 문항'}
          onClick={onPrimary}
        />
      </div>
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col bg-white text-[#191F28]">
      {children}
    </div>
  )
}

function PillButton({ label, onClick, primary, disabled }: {
  label: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${PRESS_STRONG} w-full rounded-full py-3.5 text-[15px] font-extrabold`}
      style={disabled
        ? { background: T.disabled2, color: '#FFFFFF' }
        : primary
          ? { background: T.blue, color: '#FFFFFF' }
          : { background: T.box, color: T.body2 }}
    >
      {label}
    </button>
  )
}
