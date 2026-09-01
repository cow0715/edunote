'use client'

// 오답 카드의 원본. 오답노트 탭과 분석 탭 태그 드로어가 같은 컴포넌트를 쓴다.
// (예전에는 두 곳이 각자 그려서 해설 박스가 blue / indigo 로 갈렸다.)
//
// 규칙 — vocab-example-inline.tsx 와 같은 원칙:
//   1. 색은 정오(rose·emerald)에만 쓴다. 태그·해설·첨삭은 무채색으로 눌러 답이 먼저 읽히게.
//   2. 상자를 겹치지 않는다. 카드 안에 또 배경 상자를 넣는 대신 구분선·들여쓰기로 나눈다.

import { ChevronDown, RotateCcw } from 'lucide-react'
import { FormattedQuestionText } from '@/components/grade/formatted-question-text'
import { SourceImagePreview } from '@/components/grade/source-image-preview'
import {
  ExampleSentenceInline,
  ANSWER_RIGHT_CLASS,
  ANSWER_WRONG_CLASS,
  isExampleSourceValue,
} from '@/components/grade/vocab-example-inline'
import { parseChoiceOptions } from '@/lib/vocab-example-blank'
import { StudentAnswer, VocabAnswer } from './share-types'
import { formatCorrectAnswer, formatMyAnswer, splitQuestionTexts } from './share-utils'
import { ConceptChip, ExampleBox, NoteBlock, WordRelationChips } from './share-word-parts'

const LABEL_CLASS = 'mr-1 text-[11px] text-gray-400 dark:text-gray-500'

/** 내 답 · 정답 한 줄 — 라벨을 위에 쌓지 않고 인라인으로 붙인다 */
function AnswerLine({ mine, correct }: { mine: string; correct: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
      <span className="min-w-0">
        <span className={LABEL_CLASS}>내 답</span>
        <span className={`${ANSWER_WRONG_CLASS} break-words`}>{mine}</span>
      </span>
      <span className="min-w-0">
        <span className={LABEL_CLASS}>정답</span>
        <span className={`${ANSWER_RIGHT_CLASS} break-words`}>{correct}</span>
      </span>
    </div>
  )
}

// ── 독해(진단평가) 오답 문항 ────────────────────────────────────────────────
/**
 * 한 문항(소문항 포함)을 카드 하나로 그린다.
 *
 * 내신은 한 지문에 소문항이 여러 개 달린다 (요약문 빈칸 7개짜리도 있다).
 * 소문항마다 카드를 그리면 같은 지문이 그 횟수만큼 반복돼서, 지문·유형칩은 한 번만 그리고
 * 답만 소문항별로 나열한다. 채점·통계 단위는 그대로 소문항이다 — 그리는 방식만 바꾼다.
 *
 * 소문항 답이 전부 같으면 답 줄도 한 번만 그린다. 조합 선택형((A)(B) 를 ①~⑤ 중 하나로
 * 고르는 문항)이 소문항으로 잘못 쪼개져 저장된 과거 데이터가 그렇다 — 같은 답이 복제돼
 * 있을 뿐이라 두 번 보여줄 이유가 없다.
 */
export function WrongAnswerCard({
  answers,
  token,
  weekLabel,
}: {
  /** 같은 문항 번호의 오답들 (소문항 순 정렬) */
  answers: StudentAnswer[]
  token: string
  /** 드로어처럼 여러 주차가 섞여 나올 때만 넘긴다 */
  weekLabel?: string
}) {
  const first = answers[0]
  if (!first?.exam_question) return null
  const q = first.exam_question

  // 유형칩 — 소문항끼리 태그가 다르면(어법 문항) 전부 보여준다
  const tagMap = new Map<string, string>()
  answers.forEach((a) => a.exam_question?.exam_question_tag.forEach((t) => {
    if (t.concept_tag) tagMap.set(t.concept_tag.id, t.concept_tag.name)
  }))

  // 지문은 소문항마다 "같은 본문 + 자기 문장" 형태로 복제돼 있다.
  // 아무거나 하나만 그리면 나머지 소문항 문장이 사라진다 (T/F 5문장 중 1개만 보이던 버그).
  // 공통 본문은 한 번만, 각자 문장은 자기 답 옆에 붙인다.
  const { shared: questionText, tails } = splitQuestionTexts(answers.map((a) => a.exam_question!))

  // 소문항별로 [문장 + 답 + 그 소문항의 첨삭·해설] 을 한 덩어리로 묶는다.
  // 답을 7줄 몰아놓고 해설 14개를 뒤에 붙이면 어느 해설이 어느 빈칸 것인지 알 수 없다.
  const items = answers.map((a, index) => ({
    key: a.id,
    sub: a.exam_question!.sub_label,
    tail: tails[index] ?? '',
    mine: formatMyAnswer(a),
    correct: formatCorrectAnswer(a.exam_question!),
    notes: [
      a.ai_feedback ? { label: '첨삭', text: a.ai_feedback } : null,
      a.exam_question?.explanation ? { label: '해설', text: a.exam_question.explanation } : null,
    ].filter((n): n is { label: string; text: string } => n !== null),
  }))
  const uniform = items.every((r) => r.mine === items[0].mine && r.correct === items[0].correct && !r.tail)

  // 답이 전부 같으면(오분리 레거시) 답은 한 줄만 쓰고 해설은 모아서 붙인다.
  // 이때 소문항마다 같은 해설이 복제돼 있으면 한 번만.
  const mergedNotes = items.flatMap((i) => i.notes)
  const uniqueNotes = mergedNotes.filter((n, i) => mergedNotes.findIndex((m) => m.text === n.text) === i)

  return (
    // 자리표시자 높이는 375px 폭에서 실측한 중앙값(773px)을 쓴다. 너무 작게 잡으면
    // 첫 스크롤에서 카드가 펼쳐지며 페이지가 튄다 (실측 범위 625~1230px).
    <article className="px-5 py-4 [content-visibility:auto] [contain-intrinsic-size:auto_780px]">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-bold text-gray-900 dark:text-white">
          {weekLabel && <span className="mr-1.5 font-semibold text-gray-400 dark:text-gray-500">{weekLabel}</span>}
          {q.question_number}번
          {answers.length > 1 && (
            <span className="ml-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500">
              소문항 {answers.length}개
            </span>
          )}
        </p>
        {tagMap.size > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {[...tagMap].map(([id, name]) => <ConceptChip key={id} name={name} />)}
          </div>
        )}
      </div>

      {questionText && (
        <FormattedQuestionText
          text={questionText}
          className="mt-2.5 border-l-2 border-gray-200 pl-3 text-xs leading-relaxed text-gray-600 dark:border-white/[0.12] dark:text-gray-400 text-justify"
        />
      )}

      <SourceImagePreview
        question={{
          source_image_path: q.source_image_path ?? null,
          needs_source_image: q.needs_source_image === true,
          source_page: q.source_page ?? null,
        }}
        compact
        signedUrlEndpoint={`/api/share/${token}/source-image-url`}
      />

      {uniform ? (
        <>
          <div className="mt-2.5">
            <AnswerLine mine={items[0].mine} correct={items[0].correct} />
          </div>
          {uniqueNotes.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {uniqueNotes.map((note, index) => (
                <NoteBlock key={index} label={note.label}>{note.text}</NoteBlock>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mt-2.5 space-y-3">
          {items.map((item) => (
            <div key={item.key}>
              {item.tail && (
                <FormattedQuestionText
                  text={item.tail}
                  className="mb-1 border-l-2 border-gray-200 pl-3 text-xs leading-relaxed text-gray-600 dark:border-white/[0.12] dark:text-gray-400 text-justify"
                />
              )}
              <div className="flex items-baseline gap-2">
                {item.sub && (
                  <span className="w-6 shrink-0 text-xs font-bold text-gray-400 dark:text-gray-500">({item.sub})</span>
                )}
                <AnswerLine mine={item.mine} correct={item.correct} />
              </div>
              {item.notes.length > 0 && (
                // 답 줄의 라벨 폭(w-6 + gap-2)만큼 들여써서 어느 소문항 것인지 보이게
                <div className="mt-1.5 space-y-1.5 pl-8">
                  {item.notes.map((note, index) => (
                    <NoteBlock key={index} label={note.label}>{note.text}</NoteBlock>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

// ── 단어 오답 행 ────────────────────────────────────────────────────────────
export function WrongVocabRow({ answer }: { answer: VocabAnswer }) {
  const vw = answer.vocab_word
  if (!vw) return null

  const exampleSource = isExampleSourceValue(answer.test_source) ? answer.test_source : null
  const isEnglishAnswer = answer.test_source === 'example' || answer.test_source === 'example_choice'
  // 카드 뼈대는 유형 무관하게 통일: [문제 — 시험지 그대로] → 내 답 · 정답
  // 빈칸/선택은 문장 속 문제 자리에 내 답을 넣어 "시험지에 쓴 그대로" 보여주고, 정답만 따로.
  const correctText = isEnglishAnswer ? answer.example_answer : vw.correct_answer
  const studentInSentence = isEnglishAnswer && !!answer.student_answer
  const retakeDone = answer.retake_is_correct === true

  return (
    // 375px 폭 실측 중앙값 166px (범위 142~251).
    <div className={`px-5 py-3.5 [content-visibility:auto] [contain-intrinsic-size:auto_170px] ${retakeDone ? 'opacity-60' : ''}`}>
      {/* 1. 문제 (시험지 그대로) */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {exampleSource && answer.test_prompt ? (
            <>
              <ExampleSentenceInline
                source={exampleSource}
                promptText={answer.test_prompt}
                answer={correctText}
                studentAnswer={answer.student_answer}
                isCorrect={false}
                fill="student"
              />
              {vw.example_translation && (
                <p className="mt-0.5 text-[11px] leading-4 text-gray-400 dark:text-gray-500">{vw.example_translation}</p>
              )}
            </>
          ) : (
            <span className="text-sm font-bold text-gray-900 dark:text-white">{answer.test_word ?? vw.english_word}</span>
          )}
          {answer.test_word && answer.test_word !== vw.english_word && !exampleSource && (
            <span className="ml-2 text-[10px] font-medium text-gray-400 dark:text-gray-500">원본 {vw.english_word}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {answer.retake_is_correct !== null && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              retakeDone
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                : 'bg-rose-50 text-rose-500 dark:bg-rose-950/50 dark:text-rose-400'
            }`}>
              재시험 {retakeDone ? '✓' : '✗'}
            </span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500">#{answer.test_number ?? vw.number}</span>
        </div>
      </div>

      {/* 2. 내 답 · 정답 — 한 줄 */}
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
        {!studentInSentence && (
          <span>
            <span className={LABEL_CLASS}>내 답</span>
            <span className={ANSWER_WRONG_CLASS}>{answer.student_answer || '미작성'}</span>
          </span>
        )}
        {exampleSource === 'example_choice' && answer.test_prompt ? (
          // 선택형: 두 후보를 뜻과 함께 나란히. 정답 쪽 초록, 학생이 고른 오답 빨강 취소선
          (() => {
            const options = parseChoiceOptions(answer.test_prompt)
            if (!options) return null
            const answerLower = (correctText ?? '').toLowerCase()
            const pickedLower = (answer.student_answer ?? '').toLowerCase()
            return options.map((option, index) => {
              const isAnswer = option.toLowerCase() === answerLower
              const isPicked = !isAnswer && option.toLowerCase() === pickedLower
              return (
                <span key={index}>
                  <span className={isAnswer ? ANSWER_RIGHT_CLASS : isPicked ? ANSWER_WRONG_CLASS : 'font-semibold text-gray-700 dark:text-gray-300'}>{option}</span>
                  <span className="ml-1 text-gray-500 dark:text-gray-400">{answer.choice_meanings?.[index] ?? ''}</span>
                </span>
              )
            })
          })()
        ) : (
          <>
            <span>
              <span className={LABEL_CLASS}>정답</span>
              <span className={ANSWER_RIGHT_CLASS}>{correctText || '-'}</span>
            </span>
            {/* 예문 유형은 단어의 뜻도 참고로 */}
            {exampleSource && (
              <span className="text-gray-500 dark:text-gray-400">
                <span className={LABEL_CLASS}>{vw.english_word}</span>
                {vw.correct_answer}
              </span>
            )}
          </>
        )}
      </div>

      <WordRelationChips word={vw} className="mt-2" />

      {/* 예문 유형 카드는 같은 문장이 위에 이미 있으므로 하단 예문 박스 생략 */}
      {vw.example_sentence && !exampleSource && (
        <ExampleBox sentence={vw.example_sentence} translation={vw.example_translation} className="mt-2" />
      )}
    </div>
  )
}

// ── 주차 헤더(아코디언 트리거) ──────────────────────────────────────────────
export function WeekAccordionHeader({
  title,
  date,
  count,
  countLabel,
  isOpen,
  onToggle,
}: {
  title: string
  date: string | null
  count: number
  countLabel: string
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${
        isOpen ? 'bg-gray-50 dark:bg-white/[0.04]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
      }`}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate text-sm font-bold text-gray-900 dark:text-white">{title}</span>
        {date && <span className="text-xs text-gray-400 dark:text-gray-500">{date}</span>}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:bg-white/[0.08] dark:text-gray-300">
          {count}{countLabel}
        </span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm dark:bg-white/[0.08] dark:text-gray-300">
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </span>
    </button>
  )
}

/** 단어 오답 주차의 재시험 액션 행 */
export function RetakeActionRow({
  originalWrong,
  mastered,
  started,
  onStart,
}: {
  originalWrong: number
  mastered: number
  /** 재시험을 한 번이라도 봤는지 — 아직이면 "남음" 대신 문항 수만 보여준다 */
  started: boolean
  onStart: () => void
}) {
  const remaining = originalWrong - mastered

  if (remaining <= 0) {
    return (
      <div className="flex items-center gap-1.5 px-5 py-2.5 text-xs text-gray-500 dark:text-gray-400">
        <RotateCcw className="h-3 w-3 text-emerald-500 dark:text-emerald-400" />
        재시험 완료
        <strong className="text-emerald-600 dark:text-emerald-400">{mastered}/{originalWrong}</strong>
      </div>
    )
  }

  return (
    <div className="px-5 py-2.5">
      <button
        type="button"
        onClick={onStart}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#2463EB] px-4 py-2.5 text-xs font-bold text-white transition-transform active:scale-[0.98] dark:bg-[#3B82F6]"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        재시험 보기 · {remaining}개{started ? ' 남음' : ''}
      </button>
    </div>
  )
}
