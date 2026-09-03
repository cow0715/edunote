// 기록 탭의 회차 그룹 변환.
//
// "이 기간" 과 "전체 기간" 이 같은 함수를 타므로, 기간이 섞여 들어왔을 때
// 그룹이 제대로 갈리고 최신순이 유지되는지가 핵심이다.

import { describe, expect, it } from 'vitest'
import { buildHistoryGroups, type HistorySource } from '@/app/share/[token]/history-utils'
import type { StudentAnswer, VocabAnswer, Week } from '@/app/share/[token]/share-types'

function week(over: Partial<Week> & { id: string; week_number: number }): Week {
  return {
    class_id: 'c1',
    vocab_total: 0,
    reading_total: 0,
    homework_total: 0,
    start_date: null,
    ...over,
  } as Week
}

function source(over: Partial<HistorySource> = {}): HistorySource {
  return {
    weeks: [],
    weekScores: [],
    studentAnswers: [],
    vocabAnswers: [],
    attendance: [],
    classAverages: {},
    ...over,
  }
}

const score = (over: Record<string, unknown>) => ({
  id: 's1',
  week_id: 'w1',
  reading_correct: 0,
  vocab_correct: null,
  homework_done: null,
  memo: null,
  vocab_retake_correct: null,
  ...over,
}) as HistorySource['weekScores'][number]

describe('buildHistoryGroups', () => {
  it('점수가 없는 회차는 빼고, 최신 회차가 위로 온다', () => {
    const groups = buildHistoryGroups(source({
      weeks: [
        week({ id: 'w1', week_number: 1, class_period_id: 'p1', period_label: '시즌3' }),
        week({ id: 'w2', week_number: 2, class_period_id: 'p1', period_label: '시즌3' }),
        week({ id: 'w3', week_number: 3, class_period_id: 'p1', period_label: '시즌3' }),
      ],
      weekScores: [score({ id: 's1', week_id: 'w1' }), score({ id: 's3', week_id: 'w3' })],
    }))
    expect(groups).toHaveLength(1)
    expect(groups[0].rows.map((r) => r.week.id)).toEqual(['w3', 'w1'])
  })

  it('기간이 섞이면 기간별로 갈리고, 최신 회차를 가진 기간이 위로', () => {
    const groups = buildHistoryGroups(source({
      weeks: [
        week({ id: 'w1', week_number: 1, class_period_id: 'p1', period_label: '시즌2' }),
        week({ id: 'w9', week_number: 9, class_period_id: 'p2', period_label: '시즌3' }),
      ],
      weekScores: [score({ id: 's1', week_id: 'w1' }), score({ id: 's9', week_id: 'w9' })],
    }))
    expect(groups.map((g) => g.periodLabel)).toEqual(['시즌3', '시즌2'])
  })

  it('칩은 있는 항목만 — 재시험 분모는 오답 수다', () => {
    const [group] = buildHistoryGroups(source({
      weeks: [week({ id: 'w1', week_number: 1, reading_total: 4, vocab_total: 52, homework_total: 9 })],
      weekScores: [score({
        week_id: 'w1',
        reading_correct: 2,
        vocab_correct: 40,
        vocab_retake_correct: 8,
        homework_done: 8,
      })],
      classAverages: { w1: { readingRate: 62, vocabRate: 71 } },
    }))
    expect(group.rows[0].chips).toEqual([
      { label: '시험', value: '2/4', warn: true, classDiff: -12 },
      { label: '단어', value: '40/52', warn: false, classDiff: 6 },
      { label: '재시험', value: '8/12', warn: false, classDiff: null },
      { label: '과제', value: '8/9', warn: false, classDiff: null },
    ])
  })

  it('오답 유형은 많이 틀린 순, 정답 문항은 세지 않는다', () => {
    const answer = (id: string, correct: boolean, tag: string): StudentAnswer => ({
      id,
      week_score_id: 's1',
      is_correct: correct,
      student_answer: null,
      student_answer_text: null,
      ai_feedback: null,
      exam_question: {
        id: `q${id}`,
        week_id: 'w1',
        question_number: 1,
        sub_label: null,
        exam_type: 'reading',
        question_style: 'objective',
        correct_answer: 1,
        correct_answer_text: null,
        exam_question_tag: [{ concept_tag: { id: tag, name: tag, category_id: null, category_name: null } }],
      },
    } as StudentAnswer)

    const [group] = buildHistoryGroups(source({
      weeks: [week({ id: 'w1', week_number: 1, reading_total: 4 })],
      weekScores: [score({ id: 's1', week_id: 'w1' })],
      studentAnswers: [
        answer('a', false, '내용 일치'),
        answer('b', false, '내용 일치'),
        answer('c', false, '빈칸 추론'),
        answer('d', true, '어법'),
      ],
    }))
    expect(group.rows[0].wrongTypes).toEqual([
      { name: '내용 일치', count: 2 },
      { name: '빈칸 추론', count: 1 },
    ])
    expect(group.rows[0].wrongReading).toBe(3)
  })

  it('단어 오답 수는 그 회차 답안지에서 센다', () => {
    const [group] = buildHistoryGroups(source({
      weeks: [week({ id: 'w1', week_number: 1, vocab_total: 10 })],
      weekScores: [score({ id: 's1', week_id: 'w1', vocab_correct: 8 })],
      vocabAnswers: [
        { id: 'v1', week_score_id: 's1' } as VocabAnswer,
        { id: 'v2', week_score_id: 's1' } as VocabAnswer,
      ],
    }))
    expect(group.rows[0].wrongVocab).toBe(2)
  })
})
