'use client'

// 진단평가 "다시 풀기" 플로우.
//
// design_handoff_share_report/README.md "다시풀기 플로우(진단평가)".
//
// 별도 라우트가 아니라 오답 탭 위에 덮는 전체화면이다 — 문항·선지·해설이 이미 화면에
// 로드돼 있어서, 라우트로 빼면 같은 데이터를 한 번 더 받아오게 된다.
// 채점도 서버에 보내지 않는다: 정답이 이미 손에 있고, 이 화면은 성적이 아니라 복습이다.

import { useEffect, useRef, useState } from 'react'
import { FormattedQuestionText } from '@/components/grade/formatted-question-text'
import { SourceImagePreview } from '@/components/grade/source-image-preview'
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
  sourceImage?: { source_image_path: string; source_page: number | null; needs_source_image: boolean }
  /** OX 의 수정어처럼 정답 옆에 덧붙일 것 */
  answerNote?: string | null
  /**
   * 선지를 어떻게 그리나.
   *   list    — 선지 텍스트를 세로로 (기본)
   *   markers — 번호만 가로로. 선지가 기호뿐일 때(문장 삽입 위치 등) — 고를 대상은 지문 안에 있다
   */
  layout?: 'list' | 'markers'
}

/** 선지 기호 — OX 는 T/F, 객관식은 ①②③ */
const markerOf = (q: ReviewQuestion, index: number) =>
  q.markers?.[index] ?? CIRCLE_NUM[index] ?? String(index + 1)

/** 선지가 기호뿐이면(문장 삽입 위치 등) 번호 버튼만 그린다 */
const isBareMarker = (choice: string) => /^[①②③④⑤⑥⑦⑧⑨⑩]$/.test(choice.trim())

export function buildReviewQuestions(answers: StudentAnswer[]): ReviewQuestion[] {
  return answers
    .filter((a) => !a.is_correct && a.exam_question?.exam_type === 'reading')
    .map((a): ReviewQuestion | null => {
      const q = a.exam_question!
      // 필수 그림이 없으면 텍스트만으로 풀게 하지 않는다. 원본은 오답 목록에서 확인한다.
      if (q.needs_source_image && !q.source_image_path?.trim()) return null
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
        sourceImage: q.source_image_path?.trim() ? {
          source_image_path: q.source_image_path,
          source_page: q.source_page ?? null,
          needs_source_image: q.needs_source_image === true,
        } : undefined,
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

      // 객관식은 선지가 저장돼 있어야 고를 수 있다. 밑줄·삽입처럼 시험지에 목록이 없는 유형도
      // 파서가 choices 를 채우므로(기호만이라도) 여기서 지문을 뒤지지 않는다 — 데이터가 말한다.
      const choices = q.choices ?? []
      if (q.question_style !== 'objective' || q.correct_answer === null || choices.length < 2) return null
      return {
        ...base,
        // 지문 속 위치 기호는 그대로 보존하고, 일반 선지의 중복 번호만 제거한다.
        choices: choices.map((choice, index) => {
          const trimmed = choice.trim()
          const marker = CIRCLE_NUM[index]
          return marker && trimmed.startsWith(marker) && !isBareMarker(trimmed)
            ? trimmed.slice(marker.length).trimStart()
            : choice
        }),
        layout: choices.every(isBareMarker) ? 'markers' : 'list',
        correct: q.correct_answer,
        mine: a.student_answer,
      }
    })
    .filter((q): q is ReviewQuestion => q !== null)
    .sort((a, b) => a.number - b.number)
}

export function ReadingReview({ questions, token, onClose, onGoWrongNote }: {
  questions: ReviewQuestion[]
  token: string
  onClose: () => void
  onGoWrongNote: () => void
}) {
  const [queue, setQueue] = useState(questions)
  const [qi, setQi] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [results, setResults] = useState<{ id: string; correct: boolean }[]>([])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const stemRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 })
    const focusTarget = stemRef.current ?? resultRef.current
    focusTarget?.focus({ preventScroll: true })
  }, [qi, queue])

  useEffect(() => {
    if (!revealed) return
    feedbackRef.current?.scrollIntoView({ block: 'start' })
    feedbackRef.current?.focus({ preventScroll: true })
  }, [revealed])

  const question = queue[qi]
  const done = qi >= queue.length



  if (done) {
    const correctCount = results.filter((r) => r.correct).length
    const wrongIds = new Set(results.filter((r) => !r.correct).map((r) => r.id))
    const rate = results.length > 0 ? Math.round((correctCount / results.length) * 100) : 0

    return (
      <Screen onClose={onGoWrongNote}>
        <div ref={resultRef} tabIndex={-1} aria-label="복습 결과" className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 text-center outline-none">
          <p className="text-[56px] font-black tabular-nums" style={{ color: T.blue }}>
            <CountUp value={rate} suffix="%" />
          </p>
          <p className="mt-2 text-[15px] font-bold text-[var(--share-body2)] tabular-nums">
            {results.length}문항 중 {correctCount}개 정답
          </p>
          <p className="mt-3 text-[13px] text-[var(--share-muted)]">개인 복습 결과예요. 성적에는 저장되지 않아요.</p>
        </div>
        <div className="flex shrink-0 gap-2 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
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
  }

  return (
    <Screen onClose={onClose}>
      {/* 헤더 + 진행바 */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 px-4 pt-[max(8px,env(safe-area-inset-top))] pb-2">
          <button type="button" onClick={onClose} className={`${PRESS} min-h-11 px-1 text-[13px] font-bold text-[var(--share-body2)]`}>
            ← 나가기
          </button>
          {question.typeName && (
            <span className="min-w-0 flex-1 truncate text-center text-[12px] font-bold text-[var(--share-muted2)]">
              {question.typeName}
            </span>
          )}
          <span className="ml-auto text-[13px] font-extrabold tabular-nums">
            {qi + 1} <span className="text-[var(--share-disabled)]">/ {queue.length}</span>
          </span>
        </div>
        <div className="h-1 bg-[var(--share-box)]">
          <div
            className="h-full transition-[width] duration-300"
            style={{ width: `${progress}%`, background: T.blue }}
          />
        </div>
      </div>

      {/* 지문 + 선지 */}
      <div ref={scrollerRef} aria-label="문제와 해설" className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-6">
        <div ref={stemRef} tabIndex={-1} className="mb-5 outline-none">
          <p className="mb-2 text-[13px] font-bold text-[var(--share-blue)]">{question.numberLabel}</p>
          <FormattedQuestionText text={question.stem}
            className="text-left text-[17px] font-bold leading-[1.6] break-words text-[var(--share-ink)]" />
        </div>
        {question.passage && (
          <div className="mb-6 border-y border-[var(--share-line)] py-5">
            <FormattedQuestionText
              text={question.passage}
              className="[&_strong]:font-extrabold [&_strong]:text-[var(--share-ink)] text-left text-[16px] font-normal leading-[1.75] break-words text-[var(--share-body)]"
            />
          </div>
        )}

        {question.sourceImage && (
          <div className="mb-4">
            <SourceImagePreview
              key={question.sourceImage.source_image_path}
              question={question.sourceImage}
              signedUrlEndpoint={`/api/share/${token}/source-image-url`}
            />
          </div>
        )}

        {question.layout === 'markers' && (
          <p className="mb-3 text-[13px] text-[var(--share-muted)]">지문의 기호를 확인하고 번호를 고르세요.</p>
        )}

        <div className={question.layout === 'markers' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'}>
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
                aria-pressed={picked}
                onClick={() => setSelected(number)}
                className={`${PRESS_STRONG} border-2 transition-colors ${
                  question.layout === 'markers'
                    // 텍스트가 없으므로 번호만 크게 — 지문의 밑줄과 눈으로 잇는다
                    ? 'flex h-14 w-14 items-center justify-center rounded-full'
                    : 'flex items-start gap-2.5 rounded-[16px] px-4 py-3 text-left'
                }`}
                style={{
                  borderColor: showAnswer ? T.blue : showWrong ? T.red : picked ? T.blue : T.line,
                  background: showAnswer ? T.blueBg : showWrong ? T.redBg : 'var(--share-canvas)',
                  // 정답 확인 순간에만 튀거나 흔들린다 — 어떤 선지였는지 몸으로 기억하게
                  animation: showAnswer
                    ? 'share-pop .35s ease both'
                    : showWrong ? 'share-shake .4s ease both' : undefined,
                }}
              >
                <span
                  className={question.layout === 'markers' ? 'text-[20px] font-extrabold' : 'text-[16px] font-bold leading-[1.7]'}
                  style={{ color: showAnswer ? T.blue : showWrong ? T.red : picked ? T.blue : T.muted }}
                >
                  {markerOf(question, index)}
                </span>
                {question.layout !== 'markers' && (
                  <span className="min-w-0 flex-1 text-[16px] leading-[1.7] break-words text-[var(--share-ink)]">{choice}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* 해설도 본문과 함께 스크롤한다. 고정 영역은 주요 버튼만 사용한다. */}
        {revealed && (
          <div
            ref={feedbackRef}
            tabIndex={-1}
            aria-label="풀이 결과와 해설"
            className="mt-6 scroll-mt-4 rounded-[16px] px-4 py-4 outline-none"
            style={{ background: isCorrect ? T.blueBg : T.redBg }}
            role="status"
          >
            <p className="text-[14px] font-extrabold" style={{ color: isCorrect ? T.blue : T.red }}>
              {isCorrect ? '정답이에요' : `아쉬워요 · 정답은 ${markerOf(question, question.correct - 1)}`}
              {question.answerNote && (
                <span className="ml-1.5 text-[12px] font-bold text-[var(--share-body2)]">{question.answerNote}</span>
              )}
            </p>
            {question.explanation && (
              <FormattedQuestionText text={question.explanation}
                className="mt-3 text-left text-[15px] leading-[1.75] break-words text-[var(--share-body)]" />
            )}
            {question.mine !== null && question.mine !== selected && (
              <p className="mt-3 text-[13px] text-[var(--share-muted)]">
                시험 때 고른 답 {markerOf(question, question.mine - 1)}
              </p>
            )}
            <button type="button" className={`${PRESS} mt-2 min-h-11 text-[13px] font-bold text-[var(--share-blue)]`}
              onClick={() => { scrollerRef.current?.scrollTo({ top: 0 }); stemRef.current?.focus({ preventScroll: true }) }}>
              문제 처음으로
            </button>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-[var(--share-line)] px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
        <PillButton
          primary
          disabled={!revealed && selected === null}
          label={!revealed ? '정답 확인' : qi === queue.length - 1 ? '결과 보기' : '다음 문항'}
          onClick={onPrimary}
        />
      </div>
    </Screen>
  )
}

function Screen({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current!
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog ref={dialogRef} aria-label="문제 다시 풀기" onCancel={(event) => { event.preventDefault(); onClose() }}
      className="fixed inset-0 m-auto h-[100dvh] max-h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden border-0 bg-[var(--share-canvas)] p-0 text-[var(--share-ink)] backdrop:bg-[var(--share-canvas)] open:flex">
      {children}
    </dialog>
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
        ? { background: T.disabled2, color: T.onSolid }
        : primary
          ? { background: T.blueSolid, color: T.onSolid }
          : { background: T.box, color: T.body2 }}
    >
      {label}
    </button>
  )
}
