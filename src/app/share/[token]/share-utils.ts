// share 화면 공용 순수 헬퍼 / 타입.
// 렌더 밖에서만 쓰는 계산은 전부 여기로 모아 탭 컴포넌트들이 서로를 import 하지 않게 한다.

import { formatOXStudentInput, oxNotation } from '@/lib/ox-grading'
import {
  buildQuestionDisplayText,
  buildQuestionTextFromParts,
  type StructuredQuestionParts,
} from '@/lib/question-structure'
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
 *
 * minRatio 는 "공통부가 최소 이만큼은 돼야 한다" 는 비율 기준이다. 통짜 question_text 를
 * 넘길 때는 지문이 통째로 겹치는 게 정상이라 0.3 을 요구하지만, 이미 지문을 걷어낸
 * 발문끼리 비교할 때는 0 으로 낮춘다 — 같은 문항의 소문항인 게 이미 확정이라
 * 우연히 겹칠 걱정이 없고, 비율로 재면 소문항 문장이 길수록 발문이 안 뽑힌다.
 */
export function splitCommonQuestionText(
  texts: string[],
  { minRatio = MIN_SHARED_RATIO }: { minRatio?: number } = {},
): { shared: string; tails: string[] } {
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
  if (shared.length < Math.max(MIN_SHARED_CHARS, shortest * minRatio)) {
    return { shared: '', tails: texts.map((t) => t.trim()) }
  }
  return { shared, tails: texts.map((t) => t.slice(cut).trim()) }
}

const MIN_SHARED_CHARS = 12
const MIN_SHARED_RATIO = 0.3

/**
 * 한 문항의 소문항들을 [공통 지문 + 각자 꼬리] 로 나눈다.
 *
 * 파싱이 passage 를 채워준 문항은 추측할 게 없다 — 그대로 쓴다.
 * 지문은 출력 길이 때문에 첫 소문항에만 싣게 돼 있지만(prompts.ts),
 * 소문항마다 복제돼 와도 같은 값이면 똑같이 처리한다 — LLM 출력에 여유를 둔다.
 *
 * passage 가 아예 없는 예전 데이터만 question_text 통짜에서 공통부를 잘라내는
 * splitCommonQuestionText 휴리스틱으로 넘긴다.
 */
export function splitQuestionTexts(questions: StructuredQuestionParts[]): { shared: string; tails: string[] } {
  const passages = questions.map((q) => q.passage?.trim() ?? '')
  const filled = passages.filter(Boolean)
  const stems = questions.map((q) => q.question_stem?.trim() ?? '')

  // 지문이 하나라도 있고 서로 어긋나지 않으며, 소문항 문장이 하나도 빠지지 않았을 때만 쓴다.
  // stem 이 비면 그 소문항 문장이 화면에서 통째로 사라지므로 그럴 땐 휴리스틱이 낫다.
  const usableStructure = questions.length > 1
    && filled.length > 0
    && filled.every((p) => p === filled[0])
    && stems.every(Boolean)

  if (usableStructure) {
    // 지문을 뺀 나머지 = 발문 + 그 소문항 문장 + 선지.
    // 발문("Choose True or False…")도 소문항마다 반복되므로 한 번 더 공통부를 걷어낸다.
    // 안 그러면 지문은 한 번인데 발문만 소문항 수만큼 찍힌다.
    const stemBlocks = questions.map((q) => buildQuestionTextFromParts({
      questionStem: q.question_stem,
      choices: q.choices,
    }) ?? '')
    const { shared: commonStem, tails } = splitCommonQuestionText(stemBlocks, { minRatio: 0 })

    return {
      shared: [commonStem, filled[0]].filter(Boolean).join('\n\n'),
      tails,
    }
  }

  // 폴백은 공통 문자열을 앞에서부터 맞춰보는 방식이라 표현이 문항마다 달라지면 안 된다.
  // 조각이 반쯤 채워진 문항과 통짜 문항이 섞이면 buildQuestionDisplayText 가
  // 서로 다른 조립 결과(구분 줄바꿈 수)를 내놔 공통부가 사라진다 — 통짜 쪽으로 통일한다.
  return splitCommonQuestionText(
    questions.map((q) => q.question_text?.trim() || buildQuestionDisplayText(q))
  )
}

// ── 홈 탭: 이번 주 리포트 ───────────────────────────────────────────────────
//
// 홈은 대시보드가 아니라 "이번 주 한 장 리포트" 다. 숫자를 나열하기 전에 한 문장으로
// 이번 주가 어땠는지 먼저 말한다. 문장은 학부모가 읽으므로 평가 어조를 피하고
// 사실만 적는다 (올랐어요/낮아졌어요, 모두 맞혔어요).

export type WeeklyMetric = {
  /** 정답률(%) */
  rate: number
  correct: number
  total: number
  /** 지난주 대비 %p. 지난주 기록이 없으면 null */
  delta: number | null
  /** 반 평균 대비 %p. 반 평균이 없으면 null */
  classDiff: number | null
}

export type WeeklyReportInput = {
  reading: WeeklyMetric | null
  vocab: WeeklyMetric | null
  homework: WeeklyMetric | null
}

const METRIC_LABEL = { reading: '시험', vocab: '단어', homework: '과제' } as const
type MetricKey = keyof typeof METRIC_LABEL

/** 이번 주 헤드라인 한 문장. 가장 눈에 띄는 사실 하나만 고른다 */
export function buildWeeklyHeadline(r: WeeklyReportInput): string {
  const scored: [MetricKey, WeeklyMetric][] = (['reading', 'vocab'] as const)
    .flatMap((k) => (r[k] ? [[k, r[k]!] as [MetricKey, WeeklyMetric]] : []))

  if (scored.length === 0) {
    if (r.homework) return `이번 주는 과제 ${r.homework.total}개 중 ${r.homework.correct}개를 제출했어요.`
    return '이번 주 기록이 아직 없어요.'
  }

  // 1. 지난주 대비 크게 움직인 게 있으면 그걸 먼저 말한다
  const moved = scored
    .filter(([, m]) => m.delta !== null && Math.abs(m.delta) >= 5)
    .sort((a, b) => Math.abs(b[1].delta!) - Math.abs(a[1].delta!))[0]
  if (moved) {
    const [k, m] = moved
    const dir = m.delta! > 0 ? '올랐어요' : '낮아졌어요'
    return `${METRIC_LABEL[k]} 정답률이 지난주보다 ${Math.abs(m.delta!)}%p ${dir}.`
  }

  // 2. 만점
  const perfect = scored.find(([, m]) => m.total > 0 && m.correct === m.total)
  if (perfect) {
    const [k, m] = perfect
    return `${METRIC_LABEL[k]} ${m.total}문항을 모두 맞혔어요.`
  }

  // 3. 반 평균과 차이가 있으면
  const vsClass = scored
    .filter(([, m]) => m.classDiff !== null && Math.abs(m.classDiff) >= 5)
    .sort((a, b) => Math.abs(b[1].classDiff!) - Math.abs(a[1].classDiff!))[0]
  if (vsClass) {
    const [k, m] = vsClass
    const dir = m.classDiff! > 0 ? '높았어요' : '낮았어요'
    return `${METRIC_LABEL[k]}은 반 평균보다 ${Math.abs(m.classDiff!)}%p ${dir}.`
  }

  // 4. 별다른 변화 없음 — 점수만 담담하게
  const parts = scored.map(([k, m]) => `${METRIC_LABEL[k]} ${m.correct}/${m.total}`)
  const hasPrev = scored.some(([, m]) => m.delta !== null)
  return hasPrev
    ? `${parts.join(', ')}로 지난주와 비슷했어요.`
    : `${parts.join(', ')}를 맞혔어요.`
}

/** "+8%p" / "-3%p" / "0%p" — 리포트 안에서 델타를 한 형식으로 쓴다 */
export const fmtDelta = (delta: number) => `${delta > 0 ? '+' : ''}${delta}%p`

/** 2.5 처럼 소수점 제출 기록이 있어서, 정수면 그대로, 아니면 한 자리 */
export const fmtCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * 두 주차의 문항 수가 비교 가능한가.
 * 10문항 시험 → 17문항 시험처럼 시험 종류가 바뀐 주는 정답률 차이가 실력 변화가 아니다.
 * 이런 델타를 헤드라인에 올리면 "70%p 올랐어요" 같은 오해를 만든다.
 */
export function isComparableTotal(a: number, b: number) {
  if (a <= 0 || b <= 0) return false
  return Math.min(a, b) / Math.max(a, b) >= 0.5
}

export type WeeklyNotesInput = WeeklyReportInput & {
  wrongReading: number
  wrongVocab: number
  /** 재시험을 봤는데도 아직 못 맞힌 단어 수 (재시험 안 봤으면 의미 없음) */
  retakePending: number
  retakeTaken: boolean
  /** 최근부터 연속 출석 회수 */
  attendanceStreak: number
}

/**
 * 이번 주 "잘한 점 / 챙길 점" 각 최대 2줄.
 * 이모지 칩 대신 문장 조각 — 학부모 리포트에서 긍정 피드백은 관습이고,
 * 챙길 점은 홈에서 "뭐가 문제였나" 를 답하는 유일한 자리다.
 */
export function buildWeeklyNotes(i: WeeklyNotesInput): { good: string[]; watch: string[] } {
  const good: string[] = []
  const watch: string[] = []
  const scored = (['reading', 'vocab'] as const).flatMap((k) => (i[k] ? [[k, i[k]!] as const] : []))

  // 잘한 점: 만점·고득점 > 상승 > 과제 완료 > 반 평균 상회 > 연속 출석
  for (const [k, m] of scored) {
    if (m.total > 0 && m.correct === m.total) good.push(`${METRIC_LABEL[k]} 만점`)
    else if (m.rate >= 90) good.push(`${METRIC_LABEL[k]} 정답률 ${m.rate}%`)
  }
  for (const [k, m] of scored) {
    if (m.delta !== null && m.delta >= 10) good.push(`${METRIC_LABEL[k]} 지난주보다 ${fmtDelta(m.delta)}`)
  }
  if (i.homework && i.homework.correct >= i.homework.total) good.push('과제 전부 제출')
  for (const [k, m] of scored) {
    if (m.classDiff !== null && m.classDiff >= 10) good.push(`${METRIC_LABEL[k]} 반 평균보다 ${fmtDelta(m.classDiff)}`)
  }
  if (i.attendanceStreak >= 4) good.push(`${i.attendanceStreak}회 연속 출석`)

  // 챙길 점: 하락 > 오답 수 > 과제 미제출 > 반 평균 하회
  for (const [k, m] of scored) {
    if (m.delta !== null && m.delta <= -10) watch.push(`${METRIC_LABEL[k]} 지난주보다 ${fmtDelta(m.delta)}`)
  }
  if (i.wrongVocab > 0) {
    watch.push(i.retakeTaken && i.retakePending > 0
      ? `단어 ${i.wrongVocab}개 오답 · 재시험 ${i.retakePending}개 남음`
      : `단어 ${i.wrongVocab}개 오답`)
  }
  if (i.wrongReading > 0) watch.push(`시험 ${i.wrongReading}문항 오답`)
  if (i.homework && i.homework.correct < i.homework.total) {
    watch.push(`과제 ${fmtCount(i.homework.total - i.homework.correct)}개 미제출`)
  }
  for (const [k, m] of scored) {
    if (m.classDiff !== null && m.classDiff <= -10) watch.push(`${METRIC_LABEL[k]} 반 평균보다 ${fmtDelta(m.classDiff)}`)
  }

  return { good: good.slice(0, 2), watch: watch.slice(0, 2) }
}
