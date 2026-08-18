import { describe, expect, it } from 'vitest'
import {
  computeMetrics,
  getMonthlyPeriod,
  getPreviousPeriod,
  getQuarterlyPeriod,
  getSemesterPeriod,
  qualitativeColor,
  qualitativeLabel,
  suggestGrade,
} from '@/lib/report-card'

// computeMetrics 는 3곳에서 호출된다:
//   api/report-cards/[id]  (관리자 API)
//   (admin)/students/.../[reportId]  (강사 화면)
//   report-cards/[token]  ← 학부모가 보는 공개 페이지
// 즉 여기가 틀리면 학부모에게 틀린 숫자가 나간다.

describe('getMonthlyPeriod', () => {
  it('해당 월의 1일 ~ 말일', () => {
    expect(getMonthlyPeriod(2026, 3)).toEqual({ start: '2026-03-01', end: '2026-03-31', label: '2026년 3월' })
  })

  it('평년 2월은 28일까지', () => {
    expect(getMonthlyPeriod(2026, 2).end).toBe('2026-02-28')
  })

  it('윤년 2월은 29일까지', () => {
    expect(getMonthlyPeriod(2028, 2).end).toBe('2028-02-29')
  })

  it('12월도 연도를 넘지 않는다', () => {
    expect(getMonthlyPeriod(2026, 12)).toEqual({ start: '2026-12-01', end: '2026-12-31', label: '2026년 12월' })
  })
})

describe('getQuarterlyPeriod', () => {
  it('1분기 = 1~3월', () => {
    expect(getQuarterlyPeriod(2026, 1)).toEqual({ start: '2026-01-01', end: '2026-03-31', label: '2026년 1분기' })
  })

  it('4분기 = 10~12월', () => {
    expect(getQuarterlyPeriod(2026, 4)).toEqual({ start: '2026-10-01', end: '2026-12-31', label: '2026년 4분기' })
  })
})

describe('getSemesterPeriod', () => {
  it('1학기 = 3월 1일 ~ 8월 31일', () => {
    expect(getSemesterPeriod(2026, 1)).toEqual({ start: '2026-03-01', end: '2026-08-31', label: '2026년 1학기' })
  })

  it('2학기 = 9월 1일 ~ 다음해 2월 말', () => {
    expect(getSemesterPeriod(2026, 2)).toEqual({ start: '2026-09-01', end: '2027-02-28', label: '2026년 2학기' })
  })

  it('2학기 종료일이 윤년 2월이면 29일', () => {
    expect(getSemesterPeriod(2027, 2).end).toBe('2028-02-29')
  })
})

describe('getPreviousPeriod', () => {
  it('월간 — 직전 달', () => {
    expect(getPreviousPeriod('monthly', '2026-05-01').label).toBe('2026년 4월')
  })

  it('월간 — 1월의 직전은 전년 12월', () => {
    expect(getPreviousPeriod('monthly', '2026-01-15')).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
      label: '2025년 12월',
    })
  })

  it('분기 — 직전 분기', () => {
    expect(getPreviousPeriod('quarterly', '2026-07-01').label).toBe('2026년 2분기')
  })

  it('분기 — 1분기의 직전은 전년 4분기', () => {
    expect(getPreviousPeriod('quarterly', '2026-01-01').label).toBe('2025년 4분기')
  })

  it('학기 — 1학기(3월 시작)의 직전은 전년 2학기', () => {
    expect(getPreviousPeriod('semester', '2026-03-01').label).toBe('2025년 2학기')
  })

  it('학기 — 2학기(9월 시작)의 직전은 같은 해 1학기', () => {
    expect(getPreviousPeriod('semester', '2026-09-01').label).toBe('2026년 1학기')
  })
})

describe('qualitativeLabel / qualitativeColor / suggestGrade — 경계값', () => {
  it('정성 라벨 경계', () => {
    expect(qualitativeLabel(95)).toBe('최우수')
    expect(qualitativeLabel(94)).toBe('우수')
    expect(qualitativeLabel(85)).toBe('우수')
    expect(qualitativeLabel(84)).toBe('양호')
    expect(qualitativeLabel(70)).toBe('양호')
    expect(qualitativeLabel(69)).toBe('보통')
    expect(qualitativeLabel(55)).toBe('보통')
    expect(qualitativeLabel(54)).toBe('노력')
  })

  it('값이 없으면 하이픈', () => {
    expect(qualitativeLabel(null)).toBe('-')
    expect(suggestGrade(null)).toBe('-')
  })

  it('색상도 같은 경계를 쓴다', () => {
    expect(qualitativeColor(85)).toBe('#2463EB')
    expect(qualitativeColor(84)).toBe('#10B981')
    expect(qualitativeColor(null)).toBe('#9CA3AF')
  })

  it('등급 경계', () => {
    expect(suggestGrade(90)).toBe('A')
    expect(suggestGrade(89)).toBe('B')
    expect(suggestGrade(80)).toBe('B')
    expect(suggestGrade(79)).toBe('C')
    expect(suggestGrade(70)).toBe('C')
    expect(suggestGrade(69)).toBe('D')
  })
})

// ── computeMetrics ────────────────────────────────────────────────────────

type Weeks = Parameters<typeof computeMetrics>[0]
type Scores = Parameters<typeof computeMetrics>[1]
type Answers = Parameters<typeof computeMetrics>[2]

const READING_TAG = { id: 't1', name: '빈칸완성', category_id: 'cat1', category_name: '독해' }
const GRAMMAR_TAG = { id: 't2', name: '어법', category_id: 'cat1', category_name: '독해' }

function makeAnswer(
  id: string,
  weekScoreId: string,
  isCorrect: boolean,
  question: Partial<NonNullable<Answers[number]['exam_question']>> & { id: string },
  studentAnswer: number | null = 1,
  studentAnswerText: string | null = null,
): Answers[number] {
  return {
    id,
    week_score_id: weekScoreId,
    is_correct: isCorrect,
    student_answer: studentAnswer,
    student_answer_text: studentAnswerText,
    exam_question: {
      week_id: 'w1',
      question_number: 1,
      sub_label: null,
      exam_type: 'reading',
      question_style: 'objective',
      correct_answer: 1,
      correct_answer_text: null,
      explanation: null,
      question_text: '문제',
      exam_question_tag: [{ concept_tag: READING_TAG }],
      ...question,
    },
  }
}

function buildFixture() {
  const weeks: Weeks = [
    { id: 'w1', class_id: 'c1', week_number: 1, start_date: '2026-03-02', reading_total: 10, vocab_total: 20, homework_total: 5 },
    { id: 'w2', class_id: 'c1', week_number: 2, start_date: '2026-03-09', reading_total: 10, vocab_total: 20, homework_total: 5 },
  ]
  const scores: Scores = [
    { id: 's1', week_id: 'w1', reading_correct: 8, vocab_correct: 10, homework_done: 5 },
    { id: 's2', week_id: 'w2', reading_correct: 9, vocab_correct: 20, homework_done: 4 },
  ]
  const answers: Answers = [
    makeAnswer('a1', 's1', true, { id: 'q1', question_number: 1 }),
    makeAnswer('a2', 's1', true, { id: 'q2', question_number: 2 }),
    makeAnswer('a3', 's1', true, { id: 'q3', question_number: 3 }),
    makeAnswer('a4', 's1', false, { id: 'q4', question_number: 4, correct_answer: 3 }, 2),
    makeAnswer('a5', 's1', true, {
      id: 'q5',
      question_number: 5,
      question_style: 'subjective',
      exam_question_tag: [{ concept_tag: GRAMMAR_TAG }],
    }),
    makeAnswer(
      'a6',
      's2',
      false,
      {
        id: 'q6',
        week_id: 'w2',
        question_number: 6,
        exam_type: 'vocab',
        question_style: 'subjective',
        correct_answer: null,
        correct_answer_text: 'apple',
        exam_question_tag: [],
      },
      null,
      null,
    ),
  ]
  const attendance: { status: 'present' | 'late' | 'absent' }[] = [
    { status: 'present' },
    { status: 'present' },
    { status: 'late' },
  ]
  return { weeks, scores, answers, attendance, classNameById: new Map([['c1', '정규 A']]) }
}

describe('computeMetrics — 주차별 성취율', () => {
  const f = buildFixture()
  const m = computeMetrics(f.weeks, f.scores, f.answers, f.attendance, f.classNameById)

  it('주차별 정답률을 백분율로 반올림한다', () => {
    expect(m.weekRows[0]).toMatchObject({
      week_number: 1,
      class_name: '정규 A',
      reading_rate: 80,
      vocab_rate: 50,
      homework_rate: 100,
    })
    expect(m.weekRows[1]).toMatchObject({ reading_rate: 90, vocab_rate: 100, homework_rate: 80 })
  })

  it('영역별 평균과 종합 평균', () => {
    expect(m.avgReading).toBe(85)
    expect(m.avgVocab).toBe(75)
    expect(m.avgHomework).toBe(90)
    expect(m.overallAvg).toBe(83) // round((85+75+90)/3)
  })

  it('작문(독해 서술형)은 answer 단위로 따로 집계한다', () => {
    expect(m.avgWriting).toBe(100) // a5 하나, 정답
  })

  it('최고 주차는 3영역 평균이 가장 높은 주차', () => {
    expect(m.bestWeek).toEqual({ week_number: 2, overall_rate: 90 })
  })
})

describe('computeMetrics — 출결', () => {
  const f = buildFixture()
  const m = computeMetrics(f.weeks, f.scores, f.answers, f.attendance, f.classNameById)

  it('상태별로 센다', () => {
    expect(m.attendancePresent).toBe(2)
    expect(m.attendanceLate).toBe(1)
    expect(m.attendanceAbsent).toBe(0)
    expect(m.attendanceTotal).toBe(3)
  })

  it('지각이 있으면 개근 배지를 주지 않는다', () => {
    expect(m.achievements).not.toContain('개근 (3회 전체 출석)')
  })
})

describe('computeMetrics — 태그 통계', () => {
  const f = buildFixture()
  const m = computeMetrics(f.weeks, f.scores, f.answers, f.attendance, f.classNameById)

  it('문항 수가 3개 미만인 태그는 강점/약점에서 제외한다', () => {
    expect(m.strengths.map((s) => s.name)).toEqual(['빈칸완성'])
    expect(m.strengths[0]).toMatchObject({ total: 4, correct: 3, wrong: 1, rate: 75 })
  })

  it('약점은 오답이 있는 태그만 잡는다', () => {
    expect(m.weaknesses.map((w) => w.name)).toEqual(['빈칸완성'])
  })

  it('중분류 통계는 3개 미만 태그도 합산한다', () => {
    // 빈칸완성(4문항) + 어법(1문항) = 독해 5문항, 정답 4 → 80%
    expect(m.categoryStats).toEqual([
      expect.objectContaining({ name: '독해', total: 5, correct: 4, wrong: 1, rate: 80 }),
    ])
  })

  it('vocab 문항은 태그 집계에서 빠지지만 전체 문항 수에는 들어간다', () => {
    expect(m.totalQuestions).toBe(6)
    expect(m.totalCorrect).toBe(4)
  })
})

describe('computeMetrics — 오답 목록', () => {
  const f = buildFixture()
  const m = computeMetrics(f.weeks, f.scores, f.answers, f.attendance, f.classNameById)

  it('오답만 주차·문항 번호 순으로 모은다', () => {
    expect(m.wrongItems.map((w) => w.answer_id)).toEqual(['a4', 'a6'])
  })

  it('객관식은 원문자로 표기한다', () => {
    expect(m.wrongItems[0]).toMatchObject({ week_number: 1, my_answer: '②', correct_answer: '③' })
  })

  it('서술형 미작성은 "미작성"으로 표기한다', () => {
    expect(m.wrongItems[1]).toMatchObject({ week_number: 2, my_answer: '미작성', correct_answer: 'apple' })
  })

  it('오답 항목에 태그 이름을 붙인다', () => {
    expect(m.wrongItems[0].tags).toEqual(['빈칸완성'])
    expect(m.wrongItems[1].tags).toEqual([])
  })
})

describe('computeMetrics — 값이 없을 때', () => {
  it('점수 행이 없으면 모든 비율이 null', () => {
    const f = buildFixture()
    const m = computeMetrics(f.weeks, [], [], [], f.classNameById)
    expect(m.weekRows.every((r) => r.reading_rate === null)).toBe(true)
    expect(m.avgReading).toBeNull()
    expect(m.overallAvg).toBeNull()
    expect(m.bestWeek).toBeNull()
    expect(m.avgWriting).toBeNull()
  })

  it('문항 총 개수가 0이면 비율은 null', () => {
    const weeks: Weeks = [
      { id: 'w1', class_id: 'c1', week_number: 1, start_date: '2026-03-02', reading_total: 0, vocab_total: 0, homework_total: 0 },
    ]
    const scores: Scores = [{ id: 's1', week_id: 'w1', reading_correct: 0, vocab_correct: 0, homework_done: 0 }]
    const m = computeMetrics(weeks, scores, [], [], new Map())
    expect(m.weekRows[0]).toMatchObject({ reading_rate: null, vocab_rate: null, homework_rate: null })
  })

  it('주차가 아예 없으면 빈 결과', () => {
    const m = computeMetrics([], [], [], [], new Map())
    expect(m.weekRows).toEqual([])
    expect(m.totalQuestions).toBe(0)
    expect(m.achievements).toEqual([])
  })
})

describe('computeMetrics — 성취 배지', () => {
  const f = buildFixture()
  const m = computeMetrics(f.weeks, f.scores, f.answers, f.attendance, f.classNameById)

  it('최고 주차가 90% 이상이면 배지를 준다', () => {
    expect(m.achievements).toContain('최고 주차 90% 달성')
  })

  it('결석·지각이 하나도 없으면 개근 배지를 준다', () => {
    const clean = computeMetrics(f.weeks, f.scores, f.answers, [{ status: 'present' }, { status: 'present' }], f.classNameById)
    expect(clean.achievements).toContain('개근 (2회 전체 출석)')
  })

  it('3주 연속 상승하면 배지를 준다', () => {
    const weeks: Weeks = [1, 2, 3].map((n) => ({
      id: `w${n}`,
      class_id: 'c1',
      week_number: n,
      start_date: `2026-03-0${n}`,
      reading_total: 10,
      vocab_total: 10,
      homework_total: 10,
    }))
    const scores: Scores = [
      { id: 's1', week_id: 'w1', reading_correct: 5, vocab_correct: 5, homework_done: 5 },
      { id: 's2', week_id: 'w2', reading_correct: 6, vocab_correct: 6, homework_done: 6 },
      { id: 's3', week_id: 'w3', reading_correct: 7, vocab_correct: 7, homework_done: 7 },
    ]
    const rising = computeMetrics(weeks, scores, [], [], new Map())
    expect(rising.achievements).toContain('3주 연속 점수 상승')
  })
})
