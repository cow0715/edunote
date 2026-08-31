// share 화면 공용 순수 헬퍼 / 타입.
// 렌더 밖에서만 쓰는 계산은 전부 여기로 모아 탭 컴포넌트들이 서로를 import 하지 않게 한다.

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
