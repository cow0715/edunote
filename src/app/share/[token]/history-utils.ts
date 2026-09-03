// 기록 탭("회차별 기록")이 쓰는 순수 변환.
//
// 이 탭만 "이 기간 / 전체 기간" 두 스코프를 오간다. 전체 기간은 별도 요청(scope=all)의
// 응답을 받으므로, 두 스코프가 같은 코드를 타도록 ShareData 하나만 받는 함수로 뒀다.
// (useShareModel 은 선택된 기간 하나만 다룬다 — 여기서 그걸 재사용하지 않는 이유.)

import { ShareData, StudentAnswer, Week } from './share-types'
import { fmtShortDate, getWeekLabel } from './share-utils'

/** 회차 행에 붙는 칩 하나 — "시험 2/4 반 -12%" */
export type HistoryChip = {
  label: string
  /** "2/4" */
  value: string
  /** 정답률 60% 미만이면 값이 빨강 */
  warn: boolean
  /** 반 평균 대비 %p. 없거나 차이가 0이면 null — "반 0%" 는 읽을 정보가 없다 */
  classDiff: number | null
}

export type HistoryRow = {
  week: Week
  weekLabel: string
  dateLabel: string | null
  attendance: 'present' | 'late' | 'absent' | null
  chips: HistoryChip[]
  memo: string | null
  /** 이번 회차 오답 유형 — 많이 틀린 순 */
  wrongTypes: { name: string; count: number }[]
  wrongReading: number
  wrongVocab: number
}

export type HistoryGroup = { periodId: string; periodLabel: string; rows: HistoryRow[] }

/** 필요한 배열만 받는다 — useShareModel 결과와 scope=all 응답 둘 다 그대로 들어맞는다 */
export type HistorySource = Pick<
  ShareData,
  'weeks' | 'weekScores' | 'studentAnswers' | 'vocabAnswers' | 'attendance' | 'classAverages'
>

const rate = (correct: number, total: number) => (total > 0 ? Math.round((correct / total) * 100) : null)

function chip(label: string, correct: number, total: number, classAvg: number | null | undefined): HistoryChip {
  const r = rate(correct, total)
  return {
    label,
    value: `${correct}/${total}`,
    warn: r !== null && r < 60,
    classDiff: r !== null && classAvg !== null && classAvg !== undefined && r - classAvg !== 0
      ? r - classAvg
      : null,
  }
}

/**
 * 회차를 기간별로 묶어 최신순으로 돌려준다.
 *
 * 스코프가 "이 기간" 이면 그룹이 하나뿐이지만, 그때도 같은 구조를 쓴다 —
 * 탭 컴포넌트가 스코프에 따라 두 갈래로 갈라지지 않게 하려는 것.
 */
export function buildHistoryGroups(data: HistorySource | undefined): HistoryGroup[] {
  if (!data) return []
  const { weeks, weekScores, studentAnswers, vocabAnswers, attendance, classAverages } = data

  const scoreByWeek = new Map(weekScores.map((s) => [s.week_id, s]))
  const attByDate = new Map(attendance.map((a) => [a.date, a.status]))

  const answersByScore = new Map<string, StudentAnswer[]>()
  for (const a of studentAnswers) {
    const list = answersByScore.get(a.week_score_id) ?? []
    list.push(a)
    answersByScore.set(a.week_score_id, list)
  }
  const vocabWrongByScore = new Map<string, number>()
  for (const va of vocabAnswers) {
    vocabWrongByScore.set(va.week_score_id, (vocabWrongByScore.get(va.week_score_id) ?? 0) + 1)
  }

  const groups = new Map<string, HistoryGroup>()

  for (const week of [...weeks].sort((a, b) => b.week_number - a.week_number)) {
    const score = scoreByWeek.get(week.id)
    if (!score) continue

    const ca = classAverages[week.id]
    const chips: HistoryChip[] = []
    // 시험을 봤지만 점수를 아직 안 넣은 회차가 있다 — 그대로 찍으면 "null/23" 이 나온다
    if (week.reading_total > 0 && score.reading_correct !== null) {
      chips.push(chip('시험', score.reading_correct, week.reading_total, ca?.readingRate))
    }
    if (week.vocab_total > 0 && score.vocab_correct !== null) {
      chips.push(chip('단어', score.vocab_correct, week.vocab_total, ca?.vocabRate))
      const wrong = week.vocab_total - score.vocab_correct
      // 재시험은 "틀린 것 중 몇 개를 통과했나" 라서 분모가 오답 수다
      if (wrong > 0 && score.vocab_retake_correct !== null) {
        chips.push(chip('재시험', score.vocab_retake_correct, wrong, null))
      }
    }
    if (week.homework_total > 0 && score.homework_done !== null) {
      chips.push(chip('과제', score.homework_done, week.homework_total, null))
    }

    const answers = answersByScore.get(score.id) ?? []
    const wrongReadingAnswers = answers.filter((a) => !a.is_correct && a.exam_question?.exam_type === 'reading')

    const typeCount = new Map<string, number>()
    for (const a of wrongReadingAnswers) {
      for (const t of a.exam_question?.exam_question_tag ?? []) {
        const name = t.concept_tag?.name
        if (!name) continue
        typeCount.set(name, (typeCount.get(name) ?? 0) + 1)
      }
    }

    const row: HistoryRow = {
      week,
      weekLabel: getWeekLabel(week),
      dateLabel: week.start_date ? fmtShortDate(week.start_date) : null,
      attendance: week.start_date ? attByDate.get(week.start_date) ?? null : null,
      chips,
      memo: score.memo?.trim() || null,
      wrongTypes: [...typeCount.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      wrongReading: wrongReadingAnswers.length,
      wrongVocab: vocabWrongByScore.get(score.id) ?? 0,
    }

    const periodId = week.class_period_id ?? 'none'
    const group = groups.get(periodId)
    if (group) group.rows.push(row)
    else groups.set(periodId, { periodId, periodLabel: week.period_label ?? '기록', rows: [row] })
  }

  // 그룹 자체도 최신 회차가 있는 쪽이 위로
  return [...groups.values()].sort((a, b) => b.rows[0].week.week_number - a.rows[0].week.week_number)
}
