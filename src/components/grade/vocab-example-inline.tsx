'use client'

// 채점 정오표 · 학부모 오답 카드에서 예문 유형 문항의 문장을 그리는 공용 렌더러.
//
// 원칙: 색은 "문제가 된 자리" 하나에만 쓴다. 나머지는 회색 톤으로 눌러 문장이 읽히게 한다.
// 유형은 문장 형식(괄호/밑줄/[ ])으로 이미 드러나므로 별도 뱃지·색 띠는 두지 않는다.
//
// fill 모드:
//   'answer'  — 문제 자리에 정답을 넣어 보여준다 (정오표: 학생 답은 옆 입력칸에 있음)
//   'student' — 문제 자리에 학생이 쓴 답을 넣어 "시험지에 쓴 그대로" 보여준다 (학부모 카드)
//               틀렸으면 그 자리가 빨강 취소선. 정답은 호출부에서 따로 표시.

import { splitBlankedSentence, splitChoiceSentence } from '@/lib/vocab-example-blank'

export type ExampleSource = 'example_meaning' | 'example' | 'example_choice'

export function isExampleSourceValue(value: string | null | undefined): value is ExampleSource {
  return value === 'example_meaning' || value === 'example' || value === 'example_choice'
}

/** 유형 라벨 (작은 회색 텍스트용) */
export const EXAMPLE_LABEL: Record<ExampleSource, { short: string; long: string; hint: string }> = {
  example_meaning: { short: '예문', long: '예문 뜻쓰기', hint: '강조된 단어의 뜻 쓰기' },
  example: { short: '빈칸', long: '예문 빈칸', hint: '빈칸에 영어 단어 쓰기' },
  example_choice: { short: '선택', long: '예문 선택', hint: '알맞은 단어 고르기' },
}

type Props = {
  source: ExampleSource
  /** 시험지에 인쇄된 문장 (괄호 / ___ / [ A / B ] 포함) */
  promptText: string
  /** 정답 (뜻쓰기: 한글 뜻 / 빈칸·선택: 영어) */
  answer?: string | null
  /** 학생 답 */
  studentAnswer?: string | null
  isCorrect?: boolean
  /** 문제 자리에 무엇을 채울지. 기본 'answer' */
  fill?: 'answer' | 'student'
  size?: 'xs' | 'sm'
}

const KEY = 'font-semibold text-gray-900 dark:text-white'
const MUTED = 'text-gray-500 dark:text-gray-400'
const WRONG = 'font-semibold text-rose-500 line-through decoration-rose-300 dark:text-rose-400'
const RIGHT = 'font-semibold text-emerald-600 dark:text-emerald-400'
const EMPTY = 'text-gray-300 dark:text-gray-600'

/** 정오 색 — 정답 초록 / 오답 빨강 취소선. 카드·정오표가 같은 톤을 쓰도록 export */
export const ANSWER_RIGHT_CLASS = RIGHT
export const ANSWER_WRONG_CLASS = 'text-rose-500 line-through decoration-rose-300 dark:text-rose-400'

export function ExampleSentenceInline({ source, promptText, answer, studentAnswer, isCorrect, fill = 'answer', size = 'sm' }: Props) {
  const textSize = size === 'xs' ? 'text-[11.5px] leading-[18px]' : 'text-[13px] leading-6'
  const wrong = isCorrect === false
  const student = (studentAnswer ?? '').trim()

  if (source === 'example_meaning') {
    // 문제 자리 = 괄호 단어. 학생 답(뜻)은 문장 안에 못 넣으니 항상 괄호 단어만 진하게
    const match = /\(([^()]+)\)/.exec(promptText)
    return (
      <span className={`${textSize} ${MUTED}`}>
        {match ? (
          <>
            {promptText.slice(0, match.index)}
            <span className={KEY}>{match[1]}</span>
            {promptText.slice(match.index + match[0].length)}
          </>
        ) : promptText}
      </span>
    )
  }

  if (source === 'example') {
    const parts = splitBlankedSentence(promptText)
    // 빈칸에 넣을 것: 정답 / 학생 답. student 모드에서 맞았으면 초록
    const filled = fill === 'student' ? student : (answer ?? '')
    const slotClass = fill === 'student'
      ? (!student ? EMPTY : wrong ? WRONG : RIGHT)
      : KEY
    return (
      <span className={`${textSize} ${MUTED}`}>
        {parts.map((part, index) => (
          <span key={index}>
            {part}
            {index < parts.length - 1 && (
              <span className={`${slotClass} border-b border-gray-800 px-0.5 dark:border-gray-200`}>
                {filled || '      '}
              </span>
            )}
          </span>
        ))}
      </span>
    )
  }

  const parsed = splitChoiceSentence(promptText)
  if (!parsed) return <span className={`${textSize} ${MUTED}`}>{promptText}</span>
  const answerLower = (answer ?? '').toLowerCase()
  const studentLower = student.toLowerCase()
  return (
    <span className={`${textSize} ${MUTED}`}>
      {parsed.before}
      {'[ '}
      {parsed.options.map((option, index) => {
        const lower = option.toLowerCase()
        let cls = 'text-gray-400 dark:text-gray-500'
        if (fill === 'student') {
          // 학생이 고른 쪽만 표시 (맞으면 초록, 틀리면 취소선). 정답은 호출부에서 따로
          if (lower === studentLower) cls = wrong ? WRONG : RIGHT
        } else if (lower === answerLower) {
          cls = KEY
        }
        return (
          <span key={index}>
            {index === 1 && ' / '}
            <span className={cls}>{option}</span>
          </span>
        )
      })}
      {' ]'}
      {parsed.after}
    </span>
  )
}

/** 작은 회색 유형 라벨 (뱃지 아님 — 텍스트) */
export function ExampleTag({ source, size = 'sm' }: { source: ExampleSource; size?: 'xs' | 'sm' }) {
  const label = EXAMPLE_LABEL[source]
  return (
    <span className={`shrink-0 font-semibold text-gray-400 dark:text-gray-500 ${size === 'xs' ? 'text-[10px]' : 'text-[10.5px]'}`}>
      {size === 'xs' ? label.short : label.long}
    </span>
  )
}
