// share 화면 공용 순수 헬퍼 / 타입.
// 렌더 밖에서만 쓰는 계산은 전부 여기로 모아 탭 컴포넌트들이 서로를 import 하지 않게 한다.

import { formatOXStudentInput, oxNotation } from '@/lib/ox-grading'
import { CIRCLE_NUM, ShareData, StudentAnswer, VocabAnswer, VocabWord, Week } from './share-types'

export const CHART_VISIBLE_COUNT = 8

export const EMPTY_LIST: never[] = []
export const EMPTY_AVERAGES: ShareData['classAverages'] = {}

export type ScoreField = 'reading' | 'vocab' | 'homework'

export type VocabStudyItem = {
  word: VocabWord
  week: Week
  className: string
  weekLabel: string
  wrongAnswer: VocabAnswer | null
}

export type VocabViewMode = 'all' | 'weekly'
export type VocabStudyMode = 'all' | 'wrong_only' | 'retake_pending'
export type VocabWrongFilter = 'all' | 'wrong' | 'not_wrong'
export type VocabExampleFilter = 'all' | 'with' | 'without'

/** 단어장 조회 조건 — 상태를 한 덩어리로 묶어 프리셋 이동(오답노트 → 단어장)을 쉽게 한다 */
export type VocabFilterState = {
  viewMode: VocabViewMode
  lookupOpen: boolean
  studyMode: VocabStudyMode
  search: string
  week: string
  passage: string
  pos: string
  wrong: VocabWrongFilter
  example: VocabExampleFilter
}

export const INITIAL_VOCAB_FILTER: VocabFilterState = {
  viewMode: 'all',
  lookupOpen: false,
  studyMode: 'all',
  search: '',
  week: 'all',
  passage: 'all',
  pos: 'all',
  wrong: 'all',
  example: 'all',
}

/** lookupOpen / viewMode 는 조회 "조건"이 아니라 보기 방식이라 초기화·카운트에서 제외한다 */
export function countVocabFilters(f: VocabFilterState) {
  return [
    f.studyMode !== 'all',
    !!f.search.trim(),
    f.week !== 'all',
    f.passage !== 'all',
    f.pos !== 'all',
    f.wrong !== 'all',
    f.example !== 'all',
  ].filter(Boolean).length
}

// ── 오답 포맷 ───────────────────────────────────────────────────────────────
export function formatMyAnswer(a: StudentAnswer): string {
  const q = a.exam_question!
  if (q.question_style === 'objective') {
    return a.student_answer !== null ? (CIRCLE_NUM[a.student_answer - 1] ?? String(a.student_answer)) : '미작성'
  }
  // ox(T/F) 는 학생 답이 student_answer_text 가 아니라 ox_selection 에 있다.
  // 이걸 안 보면 답을 쓴 학생도 전부 "미작성" 으로 보였다.
  if (q.question_style === 'ox') {
    const shown = formatOXStudentInput(a.ox_selection, a.student_answer_text, oxNotation(q.correct_answer_text))
    return shown || '미작성'
  }
  return a.student_answer_text?.trim() || '미작성'
}

export function formatCorrectAnswer(q: StudentAnswer['exam_question']): string {
  if (!q) return '?'
  if (q.question_style === 'objective') {
    return q.correct_answer !== null ? (CIRCLE_NUM[q.correct_answer - 1] ?? String(q.correct_answer)) : '?'
  }
  return q.correct_answer_text ?? '?'
}

// ── 단어 검색 ───────────────────────────────────────────────────────────────
export function normalizeVocabText(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase('ko-KR')
}

function joinVocabList(values: string[] | null | undefined) {
  return (values ?? []).filter(Boolean).join(', ')
}

export function matchesVocabSearch(word: VocabWord, query: string) {
  if (!query) return true
  return [
    word.english_word,
    word.correct_answer,
    joinVocabList(word.synonyms),
    joinVocabList(word.antonyms),
  ].some((value) => normalizeVocabText(value).includes(query))
}

// ── 주차 라벨 / 점수 ────────────────────────────────────────────────────────
export const getWeekLabel = (w: { id: string; week_number: number; display_label?: string }) =>
  w.display_label ?? `${w.week_number}주차`

export const fmtWeekLabel = (w: { start_date: string | null; week_number: number }) => {
  if (!w.start_date) return `${w.week_number}주`
  const [, m, d] = w.start_date.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

/** 주차 헤더에 붙는 짧은 날짜 (8/28) */
export const fmtShortDate = (date: string) =>
  new Date(date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })

export const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null

export const scoreColor = (correct: number, total: number) =>
  total === 0 ? '' : correct / total >= 0.8
    ? 'text-emerald-600 dark:text-emerald-400'
    : correct / total >= 0.6
      ? 'text-amber-500 dark:text-amber-400'
      : 'text-rose-500 dark:text-rose-400'

export const ATT_STYLE: Record<string, string> = {
  present: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800/50',
  late: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/50',
  absent: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800/50',
}
export const ATT_LABEL: Record<string, string> = { present: '출석', late: '지각', absent: '결석' }

/** sticky 헤더(약 57px) + 여백. scroll-mt-* 유틸과 값을 맞춘다 */
export const SCROLL_OFFSET_CLASS = 'scroll-mt-[69px]'

/**
 * 오답을 문항 번호로 묶는다.
 *
 * 내신 문제는 한 지문에 소문항이 여러 개 달리는 경우가 많다 (요약문 빈칸 7개 등).
 * 소문항마다 카드를 그리면 같은 지문이 그 횟수만큼 반복돼서, 화면에서는 묶어 그린다.
 * 채점·통계 단위는 그대로 소문항이다 — 그리는 방식만 바꾼다.
 */
export function groupAnswersByQuestion(answers: StudentAnswer[]): StudentAnswer[][] {
  const groups = new Map<string, StudentAnswer[]>()
  for (const answer of answers) {
    const q = answer.exam_question
    if (!q) continue
    const key = `${q.week_id}|${q.question_number}`
    const list = groups.get(key) ?? []
    list.push(answer)
    groups.set(key, list)
  }
  return [...groups.values()].map((list) =>
    list.slice().sort((a, b) => (a.exam_question!.sub_label ?? '').localeCompare(b.exam_question!.sub_label ?? ''))
  )
}

/**
 * 소문항들의 문제 지문에서 공통 부분과 각자의 꼬리를 분리한다.
 *
 * 내신 T/F·요약문 문항은 소문항마다 "같은 지문 + 자기 문장" 을 통째로 들고 있다:
 *   (a) …지문… (1) The police used social media…
 *   (b) …지문… (2) Ben Kuo is a professional…
 * 한 카드로 묶을 때 아무거나 하나만 그리면 나머지 문장이 사라진다.
 * 그래서 공통 지문은 한 번만 그리고, 각 소문항 문장은 자기 답 옆에 붙인다.
 *
 * 공통부가 너무 짧으면(우연히 몇 글자만 겹친 경우) 묶지 않고 각자 전문을 쓴다.
 */
export function splitCommonQuestionText(texts: string[]): { shared: string; tails: string[] } {
  if (texts.length === 0) return { shared: '', tails: [] }
  if (texts.length === 1) return { shared: texts[0].trim(), tails: [''] }

  // 전부 같은 지문이면 길이와 무관하게 통째로 공통 — 소문항이 답만 다른 경우다
  if (texts.every((t) => t === texts[0])) {
    return { shared: texts[0].trim(), tails: texts.map(() => '') }
  }

  const first = texts[0]
  const shortest = Math.min(...texts.map((t) => t.length))
  let i = 0
  while (i < shortest && texts.every((t) => t[i] === first[i])) i += 1

  // 단어 중간에서 자르지 않도록 마지막 공백까지 되돌린다
  let cut = i
  while (cut > 0 && !/\s/.test(first[cut - 1])) cut -= 1

  const shared = first.slice(0, cut).trim()
  // 우연히 몇 글자 겹친 정도면 공통 지문으로 치지 않는다.
  // 절대 길이로 재면 짧은 지문이 통째로 버려져서 최소 비율로 판단한다.
  if (shared.length < Math.max(MIN_SHARED_CHARS, shortest * MIN_SHARED_RATIO)) {
    return { shared: '', tails: texts.map((t) => t.trim()) }
  }
  return { shared, tails: texts.map((t) => t.slice(cut).trim()) }
}

const MIN_SHARED_CHARS = 12
const MIN_SHARED_RATIO = 0.3
